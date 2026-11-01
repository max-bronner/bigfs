import * as vscode from 'vscode';
import { decodeTga } from '../../formats/texture/textureTools';
import { parseCursorFile } from '../../formats/cursor/parseCursorFile';
import { decodePng } from '../../node/png';
import type { BuilderImage } from '../../webview/cursors/protocol';

const getFileName = (uri: vscode.Uri) =>
  uri.path.slice(uri.path.lastIndexOf('/') + 1);

/**
 * Reads a file as the images it offers the animation builder: a PNG or TGA is
 * one image with its hotspot at the top left corner, a cursor, icon or
 * animation gives each of its frames with the hotspot it stores.
 */
export const loadBuilderImages = async (
  uri: vscode.Uri,
): Promise<BuilderImage[]> => {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const name = getFileName(uri);
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase();

  if (extension === '.png' || extension === '.tga') {
    const image =
      extension === '.png' ? decodePng(bytes) : decodeTga(bytes).levels[0];

    return [{ ...image, name, hotspotX: 0, hotspotY: 0 }];
  }

  const { frames } = parseCursorFile(bytes, { decodePng });

  return frames.map((frame, index) => ({
    ...frame,
    name: frames.length > 1 ? `${name} #${index + 1}` : name,
  }));
};
