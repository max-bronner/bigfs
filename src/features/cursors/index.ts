import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { registerCursorConversionCommands } from './cursorConversionCommands';

/** Registers the cursor conversion commands */
export const registerCursors = (
  context: ExtensionContext,
  _services: Services,
): void => {
  context.subscriptions.push(registerCursorConversionCommands());
};
