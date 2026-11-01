import type { CursorFrame } from './cursorFrame';

/** Largest side an icon directory entry can state */
const MAX_ENTRY_SIDE = 256;

/**
 * Checks a frame can be written: pixels for its size, a size and a hotspot
 * an icon directory can state. Fails with a message naming the frame.
 */
export const assertWritableFrame = (frame: CursorFrame, label: string) => {
  const { width, height, hotspotX, hotspotY, pixels } = frame;

  if (
    width < 1 ||
    height < 1 ||
    width > MAX_ENTRY_SIDE ||
    height > MAX_ENTRY_SIDE
  ) {
    throw new Error(
      `${label} is ${width}x${height}; a cursor is 1 to ${MAX_ENTRY_SIDE} pixels a side`,
    );
  }

  if (pixels.length !== width * height * 4) {
    throw new Error(
      `${label} holds the wrong number of pixels for ${width}x${height}`,
    );
  }

  if (hotspotX < 0 || hotspotY < 0 || hotspotX >= width || hotspotY >= height) {
    throw new Error(
      `${label} has its hotspot at ${hotspotX},${hotspotY}, outside the image`,
    );
  }
};
