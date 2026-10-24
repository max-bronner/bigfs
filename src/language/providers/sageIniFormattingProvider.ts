import { Range, TextEdit } from 'vscode';
import type { DocumentFormattingEditProvider } from 'vscode';
import type { SageIniDocuments } from '../sageIniDocuments';
import { formatSageIni } from '../model/sageIniFormat';

/** Re-indents a file from its block structure; only whitespace changes */
export const createSageIniFormattingProvider = (
  documents: SageIniDocuments,
): DocumentFormattingEditProvider => ({
  async provideDocumentFormattingEdits(document, options) {
    const parsed = await documents.parse(document);
    const lines = Array.from(
      { length: document.lineCount },
      (_, line) => document.lineAt(line).text,
    );
    const formatted = formatSageIni(
      lines,
      parsed,
      options.insertSpaces ? ' '.repeat(options.tabSize) : '\t',
    );

    return formatted.flatMap((text, line) =>
      text === lines[line]
        ? []
        : [
            TextEdit.replace(
              new Range(line, 0, line, lines[line].length),
              text,
            ),
          ],
    );
  },
});
