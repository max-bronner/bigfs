import * as vscode from 'vscode';
import { findRuStyleLines, parseRu } from '../../formats/apt/aptGeometry';
import { registerCommand } from '../../platform/commands';
import { findGeometryMovie } from '../../services/apt/findGeometryMovie';
import { readMovieTextures } from '../../services/apt/readMovieTextures';
import type { EntryLocator } from '../../services/entryLocator';
import type { TextureRegions } from './createTextureRegions';
import { openTextureRegion } from './openTextureRegion';
import { getRuRegionId } from './ruRegionId';

const TEXTURE_STYLE = /^\s*s\s+tc:/;

/** Finds the texture style at or above the cursor of the active editor */
const findStyleAtCursor = (): { uri: vscode.Uri; line: number } | undefined => {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    return undefined;
  }
  for (let line = editor.selection.active.line; line >= 0; line--) {
    if (TEXTURE_STYLE.test(editor.document.lineAt(line).text)) {
      return { uri: editor.document.uri, line };
    }
  }
  return undefined;
};

/**
 * Registers `bigfs.showRuRegion`, which opens the texture a `.ru` texture
 * style samples with the part it uses selected. The texture is found through
 * the movie beside the geometry folder: its Image character, then the `.dat`.
 * It takes the document and line the code lens passes, or finds the style at
 * the cursor.
 */
export const registerShowRuRegion = (
  locator: EntryLocator,
  regions: TextureRegions,
): vscode.Disposable =>
  registerCommand(
    'bigfs.showRuRegion',
    async (uri?: vscode.Uri, line?: number) => {
      const source =
        uri && line !== undefined ? { uri, line } : findStyleAtCursor();

      if (!source) {
        void vscode.window.showInformationMessage(
          'Put the cursor in a texture style (a line starting "s tc:") of a .ru file first.',
        );
        return;
      }

      const document = await vscode.workspace.openTextDocument(source.uri);
      const text = document.getText();
      const run = parseRu(text)[findRuStyleLines(text).indexOf(source.line)];

      if (run?.style.kind !== 'texture') {
        void vscode.window.showWarningMessage(
          'That line is not a texture style.',
        );
        return;
      }

      const aptUri = await findGeometryMovie(source.uri);
      const movie = aptUri && (await readMovieTextures(aptUri));
      const path = movie?.imageTextures.get(run.style.character);

      if (!path) {
        void vscode.window.showWarningMessage(
          movie
            ? `Image #${run.style.character} has no texture in the movie's .dat.`
            : 'The movie this geometry belongs to (<name>.apt, .const and .dat beside the _geometry folder) was not found.',
        );
        return;
      }

      const texture = await locator.findUri(path, source.uri);

      if (!texture) {
        void vscode.window.showWarningMessage(
          `${path} is in no archive or folder`,
        );
        return;
      }
      await openTextureRegion(regions, texture, getRuRegionId(source));
    },
  );
