import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { AptEditorProvider } from './aptEditorProvider';
import { registerAptTextLanguage } from './aptTextLanguage';
import { registerAptCommands } from './aptCommands';

/** Registers the APT movie editor, its text view and the APT commands */
export const registerApt = (
  context: ExtensionContext,
  { tools, locator, archives, gameLanguage, iniIndex }: Services,
): void => {
  const editor = AptEditorProvider.register(
    tools,
    locator,
    archives,
    context.extensionUri,
    {
      gameLanguage,
      index: iniIndex,
      state: context.workspaceState,
    },
  );

  context.subscriptions.push(editor, registerAptTextLanguage());
  registerAptCommands(context, editor, archives);
};
