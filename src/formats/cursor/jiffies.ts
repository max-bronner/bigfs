/** Jiffies per second: the unit an animated cursor's durations are stored in */
export const JIFFIES_PER_SECOND = 60;

/** Converts a stored duration to milliseconds, rounded */
export const jiffiesToMilliseconds = (jiffies: number): number =>
  Math.round((jiffies * 1000) / JIFFIES_PER_SECOND);

/** Converts milliseconds to the nearest whole jiffy, at least one since a step cannot last none */
export const millisecondsToJiffies = (milliseconds: number): number =>
  Math.max(1, Math.round((milliseconds * JIFFIES_PER_SECOND) / 1000));
