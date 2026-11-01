import * as vscode from 'vscode';
import { PREVIEW_VIEW_TYPE } from '../../constants';
import type { TextureRegions } from './createTextureRegions';

/** Opens a texture beside the editor with a region selected on it, in the preview already showing it if there is one */
export const openTextureRegion = async (
  regions: TextureRegions,
  texture: vscode.Uri,
  regionId: string,
): Promise<void> => {
  regions.focus(texture, regionId);
  await vscode.commands.executeCommand(
    'vscode.openWith',
    texture,
    PREVIEW_VIEW_TYPE,
    vscode.ViewColumn.Beside,
  );
};
