import * as vscode from 'vscode';

const HEADER = /^\s*MappedImage\s+\S+/i;

/** Registers a lens over every `MappedImage` header that opens its texture with the rectangle selected */
export const registerMappedImageLens = (
  selector: vscode.DocumentSelector,
): vscode.Disposable =>
  vscode.languages.registerCodeLensProvider(selector, {
    provideCodeLenses(document) {
      const lenses: vscode.CodeLens[] = [];

      for (let line = 0; line < document.lineCount; line++) {
        if (HEADER.test(document.lineAt(line).text)) {
          lenses.push(
            new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
              title: 'Edit region in texture',
              command: 'bigfs.editMappedImageRegion',
              arguments: [document.uri, line],
            }),
          );
        }
      }
      return lenses;
    },
  });
