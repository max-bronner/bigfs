import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { registerLaunchCommands } from './launchCommands';
import { registerInstallDetectCommands } from './installDetectCommands';

/** Registers the game launch button and the install detection commands */
export const registerInstalls = (
  context: ExtensionContext,
  { archives }: Services,
): void => {
  registerLaunchCommands(context);
  registerInstallDetectCommands(context, archives.whenReady());
};
