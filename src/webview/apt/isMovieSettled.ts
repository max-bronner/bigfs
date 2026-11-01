import type { Instance } from './instance';

/** Ticks after which a root that never stops counts as settled, about two seconds */
const MAX_SETTLE_TICKS = 60;

/**
 * Whether a movie has started up far enough for the engine to call into it:
 * its root stopped, or has no more frames to play. A call made sooner reaches
 * clips the movie has not placed yet, and does nothing.
 */
export const isMovieSettled = (
  root: Pick<Instance, 'playing' | 'frames'>,
  ticks: number,
): boolean =>
  !root.playing || root.frames.length <= 1 || ticks >= MAX_SETTLE_TICKS;
