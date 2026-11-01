/** Key flags of one frame's chunks, as the seek needs them */
export interface SeekFrame {
  isKey: boolean;
  /** The frame's alpha chunk, when it carries one */
  alpha?: Uint8Array;
  isAlphaKey?: boolean;
}

/** Where a decode must restart: the first frame and each stream's key frame */
export interface SeekRestart {
  start: number;
  colourFrom: number;
  alphaFrom: number;
}

/** Frames decoded forward in place before a restart from a key frame is cheaper */
const forwardLimit = 60;

/**
 * Decides how to reach `target` when the decoders have decoded up to, not
 * including, `next`. Returns `undefined` to keep decoding forward, or the
 * key frames to restart from. Colour and alpha key independently, so the
 * restart is at the earlier of their key frames at or before the target.
 */
export const planSeek = (
  frames: readonly SeekFrame[],
  hasAlpha: boolean,
  next: number,
  target: number,
): SeekRestart | undefined => {
  if (target >= next && target - next <= forwardLimit) {
    return undefined;
  }

  let colourFrom = target;

  while (colourFrom > 0 && !frames[colourFrom].isKey) {
    colourFrom--;
  }

  let alphaFrom = hasAlpha ? target : colourFrom;

  while (
    hasAlpha &&
    alphaFrom > 0 &&
    !(frames[alphaFrom].alpha && frames[alphaFrom].isAlphaKey)
  ) {
    alphaFrom--;
  }

  const start = Math.min(colourFrom, alphaFrom);

  // Already past the key frames and not going back: decoding on is no longer
  return start >= next || target < next
    ? { start, colourFrom, alphaFrom }
    : undefined;
};
