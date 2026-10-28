/** The message of a caught value, which is anything a `throw` can carry */
export const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
