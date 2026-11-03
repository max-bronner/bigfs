import { getBoxCorners } from './pickBox';
import type { Box } from './pickBox';

/** Half the side of a corner handle, in screen pixels */
export const HANDLE_RADIUS = 5;

/** Draws a white square on each corner of a box, `scale` being screen pixels per unit of the canvas transform */
export const drawBoxHandles = (
  ctx: CanvasRenderingContext2D,
  box: Box,
  scale: number,
): void => {
  const radius = HANDLE_RADIUS / scale;

  ctx.fillStyle = 'white';
  for (const [x, y] of getBoxCorners(box)) {
    ctx.fillRect(x - radius, y - radius, 2 * radius, 2 * radius);
    ctx.strokeRect(x - radius, y - radius, 2 * radius, 2 * radius);
  }
};
