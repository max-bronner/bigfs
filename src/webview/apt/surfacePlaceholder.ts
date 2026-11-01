import type { Rect } from '../../formats/apt/aptMovie';

/** Marks a surface with nothing to show: its box dashed, with a label saying why */
export const paintPlaceholder = (
  ctx: CanvasRenderingContext2D,
  [left, top, right, bottom]: Rect,
  label: string,
): void => {
  const { a, b } = ctx.getTransform();
  const pixel = 1 / (Math.hypot(a, b) || 1);

  ctx.strokeStyle = ctx.fillStyle = '#c0c';
  ctx.setLineDash([4 * pixel, 3 * pixel]);
  ctx.lineWidth = pixel;
  ctx.strokeRect(left, top, right - left, bottom - top);
  ctx.font = `${11 * pixel}px monospace`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(label, left + 2 * pixel, top + 12 * pixel);
};
