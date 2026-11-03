import { Range, TextEdit } from 'vscode';
import type { DocumentFormattingEditProvider } from 'vscode';
import type { SageIniDocuments } from '../../../services/ini/sageIniDocuments';
import { formatSageIniStable } from '../../../formats/ini/sageIniFormat';
import { isFragmentPath, parseSageIni } from '../../../formats/ini/sageIniParser';

/** Creates the formatting provider, which re-indents a file from its block structure; only whitespace changes */
export const createSageIniFormattingProvider = (
  documents: SageIniDocuments,
): DocumentFormattingEditProvider => ({
  async provideDocumentFormattingEdits(document, options) {
    const schema = await documents.getSchema();
    const isFragment = isFragmentPath(document.uri.path);
    const lines = Array.from(
      { length: document.lineCount },
      (_, line) => document.lineAt(line).text,
    );
    const formatted = formatSageIniStable(
      lines,
      (text) => parseSageIni(text, schema, { isFragment }),
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
