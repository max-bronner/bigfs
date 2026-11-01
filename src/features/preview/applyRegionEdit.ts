import * as vscode from 'vscode';

/**
 * Applies a text edit that moves a region's box to the document that defines
 * it. The document is left unsaved so the editor's undo takes the change
 * back, and is shown beside the preview, at `line`, when no editor shows it.
 *
 * @returns whether the edit was applied
 */
export const applyRegionEdit = async (
  document: vscode.TextDocument,
  change: vscode.WorkspaceEdit,
  line: number,
): Promise<boolean> => {
  const applied = await vscode.workspace.applyEdit(change);

  if (
    applied &&
    !vscode.window.visibleTextEditors.some(
      (editor) => editor.document === document,
    )
  ) {
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
      preview: false,
      selection: new vscode.Range(line, 0, line, 0),
    });
  }
  return applied;
};
