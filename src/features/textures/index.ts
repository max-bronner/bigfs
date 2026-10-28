import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { registerTextureCommands } from '../../commands/textureCommands';

/** Registers the texture export, import and conversion commands */
export const registerTextures = (
  context: ExtensionContext,
  _services: Services,
): void => {
  registerTextureCommands(context);
};
