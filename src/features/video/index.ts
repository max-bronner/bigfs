import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { registerVideoCommands } from './videoCommands';

/** Registers the VP6 video conversion command */
export const registerVideo = (
  context: ExtensionContext,
  _services: Services,
): void => {
  registerVideoCommands(context);
};
