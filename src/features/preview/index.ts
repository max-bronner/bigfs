import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { createTextureRegions } from './createTextureRegions';
import { PreviewEditorProvider } from './previewEditorProvider';
import { registerEditMappedImageRegion } from './registerEditMappedImageRegion';

/** Registers the preview editor for textures, audio, cursors and W3D models, and the commands that open a texture on a region */
export const registerPreview = (
  context: ExtensionContext,
  { tools, locator, archives }: Services,
): void => {
  const regions = createTextureRegions(archives);

  context.subscriptions.push(
    regions,
    PreviewEditorProvider.register(
      tools,
      locator,
      context.extensionUri,
      regions,
    ),
    registerEditMappedImageRegion(archives, locator, regions),
  );
};
