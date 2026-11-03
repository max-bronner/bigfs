/** One move of the viewer's playhead */
export interface PlayheadMove {
  /** Where it stands, in seconds */
  time: number;
  /** It went past the end and starts over */
  hasWrapped: boolean;
  /** It reached the end and stops there */
  hasEnded: boolean;
}

/**
 * Moves the playhead on by `elapsed` seconds. A `length` of 0 means nothing
 * sets an end, as with materials that animate for ever. While `isBusy`, as
 * when an effect outlives the timeline, it runs on past the end.
 */
export const advancePlayhead = (
  time: number,
  elapsed: number,
  length: number,
  isBusy: boolean,
  shouldLoop: boolean,
): PlayheadMove => {
  const next = time + elapsed;

  if (!length || next < length || isBusy) {
    return { time: next, hasWrapped: false, hasEnded: false };
  }
  return shouldLoop
    ? { time: 0, hasWrapped: true, hasEnded: false }
    : { time: length, hasWrapped: false, hasEnded: true };
};
