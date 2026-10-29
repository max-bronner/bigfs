/** Waits the given number of milliseconds, for work that steps aside or retries later */
export const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
