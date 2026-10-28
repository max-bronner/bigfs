import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { registerW3dAnimationCommands } from './w3dAnimationCommands';

/** Registers the W3D animation editing command */
export const registerW3d = (
  context: ExtensionContext,
  _services: Services,
): void => {
  context.subscriptions.push(registerW3dAnimationCommands());
};
