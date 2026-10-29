import { commands, window } from 'vscode';
import type { Disposable, LogOutputChannel } from 'vscode';
import { describeError } from '../core/errors';
import { guardCommand } from './guardCommand';

let log: LogOutputChannel | undefined;

/** Sets the output channel that command failures are written to */
export const setCommandLog = (channel: LogOutputChannel): void => {
  log = channel;
};

/**
 * Registers a command whose thrown error is shown once with
 * `window.showErrorMessage`, and logged when a command log is set
 */
export const registerCommand = (
  id: string,
  // any, as in `commands.registerCommand`: the arguments come from the caller of the command
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => unknown,
): Disposable =>
  commands.registerCommand(
    id,
    guardCommand(
      id,
      handler,
      () => ({
        showError: (message) => void window.showErrorMessage(message),
        logError: log && ((name, error) => log?.error(name, error)),
      }),
      describeError,
    ),
  );
