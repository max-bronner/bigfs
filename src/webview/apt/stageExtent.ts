import { union } from './scene';
import type { Rect } from '../../formats/apt/aptMovie';

/**
 * Widens the canvas extent to take in a frame. A movie shows its screen, as
 * the game does, so a menu's parked off-screen parts do not count. Nothing
 * widens while animating, or Fit would shrink the picture with every frame.
 */
export const growExtent = (
  extent: Rect,
  frameBox: Rect | undefined,
  { isScreen, isAnimating }: { isScreen: boolean; isAnimating: boolean },
): Rect =>
  frameBox && !isScreen && !isAnimating ? union([extent, frameBox])! : extent;
