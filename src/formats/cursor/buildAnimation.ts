import type { AnimatedCursor, CursorFrame } from './cursorFrame';

/** One frame of an animation being put together, and how long it shows */
export interface AnimationRow {
  frame: CursorFrame;
  jiffies: number;
}

/** Makes an animated cursor that shows each row's frame once, in order, for the row's time */
export const buildAnimation = (rows: AnimationRow[]): AnimatedCursor => ({
  frames: rows.map((row) => row.frame),
  steps: rows.map((row, frame) => ({ frame, jiffies: row.jiffies })),
});
