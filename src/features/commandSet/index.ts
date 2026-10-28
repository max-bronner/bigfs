import type { ExtensionContext } from 'vscode';
import { SAGE_INI_LANGUAGE } from '../../constants';
import type { Services } from '../../services/createServices';
import { registerCommandSetEditor } from './commandSetEditor';

/** Registers the CommandSet editor and its lens */
export const registerCommandSet = (
  context: ExtensionContext,
  { iniDocuments, iniIndex, locator }: Services,
): void => {
  context.subscriptions.push(
    ...registerCommandSetEditor(
      context,
      { language: SAGE_INI_LANGUAGE },
      iniDocuments,
      iniIndex,
      locator,
    ),
  );
};
