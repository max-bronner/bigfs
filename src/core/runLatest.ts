/**
 * Wraps `action` so it never runs twice at once. Calls that arrive while it
 * runs are answered by a single further run that starts when the current one
 * ends, so a burst of changes costs at most two runs and the last one sees
 * the state after the final change.
 */
export const runLatest = (action: () => Promise<void>): (() => Promise<void>) => {
  let running: Promise<void> | undefined;
  let following: Promise<void> | undefined;

  const start = (): Promise<void> => {
    const current = action().finally(() => {
      running = undefined;
    });

    running = current;
    return current;
  };

  return () => {
    if (!running) {
      return start();
    }

    following ??= running
      .catch(() => undefined)
      .then(() => {
        following = undefined;
        return start();
      });
    return following;
  };
};
