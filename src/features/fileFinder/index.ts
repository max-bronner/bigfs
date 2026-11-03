import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { registerCommand } from '../../platform/commands';
import { goToFile } from './goToFile';

/** Registers the command that finds a file by name in every archive and install */
export const registerFileFinder = (
  context: ExtensionContext,
  { gameView }: Services,
): void => {
  context.subscriptions.push(
    registerCommand('bigfs.goToFile', () => goToFile(context, gameView)),
  );
};
