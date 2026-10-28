import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { PreviewEditorProvider } from '../../providers/previewEditorProvider';

/** Registers the preview editor for textures, audio and W3D models */
export const registerPreview = (
  context: ExtensionContext,
  { tools, locator }: Services,
): void => {
  context.subscriptions.push(
    PreviewEditorProvider.register(tools, locator, context.extensionUri),
  );
};
