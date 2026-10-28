import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { registerModDiffCommands } from './modDiffCommands';

/** Registers the mod diff against the base game and mod packaging */
export const registerMods = (
  context: ExtensionContext,
  { gameView }: Services,
): void => {
  registerModDiffCommands(context, gameView);
};
