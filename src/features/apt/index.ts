import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { AptEditorProvider } from '../../providers/aptEditorProvider';
import { registerAptTextLanguage } from '../../providers/aptTextLanguage';
import { registerAptCommands } from '../../commands/aptCommands';

/** Registers the APT movie editor, its text view and the APT commands */
export const registerApt = (
  context: ExtensionContext,
  { tools, locator, archives, gameLanguage, iniIndex }: Services,
): void => {
  context.subscriptions.push(
    AptEditorProvider.register(tools, locator, archives, context.extensionUri, {
      gameLanguage,
      index: iniIndex,
      state: context.workspaceState,
    }),
    registerAptTextLanguage(),
  );
  registerAptCommands(context);
};
