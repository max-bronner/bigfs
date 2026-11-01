import * as vscode from 'vscode';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import { isEditable, offerOverride } from '../../services/ini/archiveText';
import {
  getCoordsEdit,
  readMappedImageBlock,
} from '../../formats/mappedImage/mappedImageEdit';
import { getMappedCoords } from '../../formats/mappedImage/mappedRegion';
import { applyRegionEdit } from './applyRegionEdit';
import type { MappedImageSource } from './mappedImageRegionId';

/**
 * Writes a rect, in pixels of the decoded texture, into the `Coords` of the
 * `MappedImage` block as one text edit on its document. A block in a
 * read-only archive entry is not touched; the user is offered an override in
 * a folder instead.
 *
 * @returns whether the document was changed
 */
export const writeMappedImageRegion = async (
  archives: ArchiveModel,
  source: MappedImageSource,
  decoded: readonly [number, number],
  rect: readonly [number, number, number, number],
): Promise<boolean> => {
  if (!isEditable(archives, source.uri)) {
    await offerOverride(
      archives,
      [source.uri],
      'This MappedImage is in a read-only archive. Override the file in a folder to edit its region.',
    );
    return false;
  }

  const document = await vscode.workspace.openTextDocument(source.uri);
  const lines = document.getText().split(/\r?\n/);
  const block = readMappedImageBlock(lines, source.line);
  const edit =
    block &&
    getCoordsEdit(
      lines,
      source.line,
      getMappedCoords(block.image, decoded, {
        left: rect[0],
        top: rect[1],
        right: rect[2],
        bottom: rect[3],
      }),
    );

  if (!edit) {
    void vscode.window.showWarningMessage(
      'The MappedImage block moved or was closed since the texture opened; open its texture again.',
    );
    return false;
  }

  const change = new vscode.WorkspaceEdit();

  if (edit.insertsLine) {
    change.insert(
      source.uri,
      new vscode.Position(edit.line, 0),
      `${edit.text}${document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'}`,
    );
  } else {
    change.replace(
      source.uri,
      new vscode.Range(edit.line, edit.start, edit.line, edit.end),
      edit.text,
    );
  }

  return applyRegionEdit(document, change, edit.line);
};
