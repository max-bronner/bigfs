import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { createNodeCommandRegistrar } from '../../services/archives/nodeCommands';
import { registerModCommands } from './modCommands';
import { registerModDiffCommands } from './modDiffCommands';

/**
 * Registers the mod commands: overriding rows in a folder, packing a folder,
 * searching the archives, the mod diff against the base game and packaging
 */
export const registerMods = (
  context: ExtensionContext,
  { archives, gameView, explorerSelection }: Services,
): void => {
  context.subscriptions.push(
    ...registerModCommands(
      createNodeCommandRegistrar(context, explorerSelection),
      archives,
    ),
  );
  registerModDiffCommands(context, gameView);
};
