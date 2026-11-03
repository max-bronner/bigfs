/** A width and a height in CSS pixels */
export interface Size {
  width: number;
  height: number;
}

/** Smallest scale a texture is fitted to, the inverse of the largest zoom */
export const MIN_FIT_SCALE = 1 / 32;

/**
 * Gets the scale at which a texture lies whole inside the room it has: never
 * above 1, so a small texture is not stretched, and never below
 * `MIN_FIT_SCALE`, so a window with no room left still shows something.
 */
export const getFitScale = (room: Size, texture: Size): number =>
  Math.max(
    MIN_FIT_SCALE,
    Math.min(1, room.width / texture.width, room.height / texture.height),
  );
