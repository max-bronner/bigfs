import { commands, window } from 'vscode';
import type { ExtensionContext, Uri } from 'vscode';
import type { Services } from '../../services/createServices';
import { registerSageStrLanguage } from './sageStrLanguage';
import {
  CSF_VIEW_TYPE,
  CsfEditorProvider,
  STR_TABLE_VIEW_TYPE,
  StrTableEditorProvider,
} from './stringTableEditorProvider';
import { registerCommand } from '../../platform/commands';

/**
 * Registers the string features: the STR language, the `.str` and `.csf`
 * table editors, and the command that picks the game language
 */
export const registerStrings = (
  context: ExtensionContext,
  { gameLanguage }: Services,
): void => {
  context.subscriptions.push(
    registerCommand('bigfs.chooseLanguage', () =>
      gameLanguage.choose(),
    ),
  );
  registerSageStrLanguage(context);
  context.subscriptions.push(
    window.registerCustomEditorProvider(
      STR_TABLE_VIEW_TYPE,
      new StrTableEditorProvider(context.extensionUri),
    ),
    window.registerCustomEditorProvider(
      CSF_VIEW_TYPE,
      new CsfEditorProvider(context.extensionUri),
      { supportsMultipleEditorsPerDocument: true },
    ),
    registerCommand('bigfs.openStringTable', (uri?: Uri) => {
      const target = uri ?? window.activeTextEditor?.document.uri;

      return target
        ? commands.executeCommand('vscode.openWith', target, STR_TABLE_VIEW_TYPE)
        : undefined;
    }),
  );
};
