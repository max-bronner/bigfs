/** Scripts one frame, event or call may start between them */
const MAX_SCRIPTS = 1000;

/** The order queued scripts run in: a lower number empties first */
export const SCRIPT_PRIORITY = { initialize: 0, construct: 1, normal: 2 };

/** Queue of the scripts a movie has waiting, by `SCRIPT_PRIORITY` */
export interface ScriptQueue {
  /** Queues a script to run after those already waiting at its priority */
  add(script: () => void, priority?: number): void;
  /** Runs what is waiting, unless a script is running or the queue is held */
  drain(): void;
  /** Runs `queue`, holding what it adds; `drain` runs that once the caller is ready */
  hold<Result>(queue: () => Result): Result;
}

/**
 * Creates the queue a player runs its scripts through. A frame a script's goto
 * enters queues its script to run after the one that went, so scripts that goto
 * each other take turns instead of nesting without end (mint's `ActionQueue`,
 * after Ruffle).
 *
 * @param isBlocked - whether no script may start now
 * @param onOverflow - told the limit when scripts keep starting each other
 */
export const createScriptQueue = (
  isBlocked: () => boolean,
  onOverflow: (limit: number) => void,
): ScriptQueue => {
  const buckets: (() => void)[][] = [[], [], []];
  let isHeld = false;

  const takeNext = () => buckets.find((bucket) => bucket.length)?.shift();

  const runWaiting = () => {
    for (let ran = 0; ; ran++) {
      const script = takeNext();

      if (!script) {
        return;
      }
      if (ran >= MAX_SCRIPTS) {
        onOverflow(MAX_SCRIPTS);
        buckets.forEach((bucket) => (bucket.length = 0));
        return;
      }
      script();
    }
  };

  const hold = <Result>(queue: () => Result): Result => {
    const wasHeld = isHeld;

    isHeld = true;
    try {
      return queue();
    } finally {
      isHeld = wasHeld;
    }
  };

  const drain = () => {
    if (!isHeld && !isBlocked()) {
      hold(runWaiting);
    }
  };

  return {
    add: (script, priority = SCRIPT_PRIORITY.normal) =>
      void buckets[priority].push(script),
    drain,
    hold,
  };
};
