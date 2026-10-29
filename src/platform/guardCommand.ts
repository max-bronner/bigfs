/** Where a command's uncaught error goes: the user, and the log when there is one */
export interface CommandErrorSink {
  /** Shows the message of the failed command to the user */
  showError: (message: string) => void;
  /** Writes the failure to the output channel */
  logError?: (id: string, error: unknown) => void;
}

/**
 * Wraps a command handler so an error it throws, or a promise it rejects with,
 * is reported once instead of escaping into VS Code
 */
export const guardCommand = <Args extends unknown[], Result>(
  id: string,
  handler: (...args: Args) => Result,
  sink: () => CommandErrorSink,
  describe: (error: unknown) => string,
): ((...args: Args) => Result | undefined) => {
  const report = (error: unknown): undefined => {
    const { showError, logError } = sink();

    logError?.(id, error);
    showError(describe(error));
    return undefined;
  };

  return (...args) => {
    try {
      const result = handler(...args);

      return result instanceof Promise
        ? (result.catch(report) as Result)
        : result;
    } catch (error) {
      return report(error);
    }
  };
};
