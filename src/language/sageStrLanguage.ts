import * as vscode from 'vscode';
import { parseCsf, writeCsf } from '../formats/csf/csf';
import { parseStringRecords, quoteStringText } from '../formats/str/sageStringRecords';
import {
  decodeIniText,
  encodeWindows1252,
  unencodableCharacters,
} from '../core/windows1252';
import { toUri } from '../services/archives/commandTarget';
import type { CommandTarget } from '../services/archives/commandTarget';
import type { ArchiveModel } from '../services/archives/archiveModel';
import { registerTranslationCheck } from './translationCheck';

/**
 * Language support for `.str` string tables: problems, an outline of labels,
 * folding per record, and converting between `.str` and `.csf`.
 */

export const STR_LANGUAGE = 'sage-str';

const selector: vscode.DocumentSelector = { language: STR_LANGUAGE };

/** The problems a reader of the file would trip over */
export const findStrProblems = (
  source: string,
): { start: number; end: number; message: string; isError: boolean }[] => {
  const problems: {
    start: number;
    end: number;
    message: string;
    isError: boolean;
  }[] = [];
  const firsts = new Map<string, number>();

  for (const record of parseStringRecords(source)) {
    const key = record.label.toLowerCase();
    const first = firsts.get(key);
    const at = record.labelSpan;

    if (/\s|"/.test(record.label)) {
      problems.push({
        ...at,
        message:
          'A label cannot hold spaces or quotes; is a line missing before it?',
        isError: true,
      });
    }

    if (first !== undefined) {
      problems.push({
        ...at,
        message: `Duplicate of the label on line ${first + 1}; the game uses the first`,
        isError: false,
      });
    } else {
      firsts.set(key, record.line);
    }

    if (!record.hasEnd) {
      problems.push({
        ...at,
        message: 'This record has no END',
        isError: true,
      });
    }

    if (record.text === undefined) {
      problems.push({
        ...at,
        message: 'This record has no quoted text',
        isError: false,
      });
    } else if (record.isUnclosed && record.textSpan) {
      problems.push({
        start: record.textSpan.start,
        end: record.textSpan.start + 1,
        message: 'The text has no closing quote',
        isError: true,
      });
    }
  }

  return problems;
};

/** A `.str` file's text from a `.csf`; speech names have no place in it */
export const csfToStr = (
  bytes: Uint8Array,
  eol = '\r\n',
): { text: string; dropped: number; unencodable: string[] } => {
  const file = parseCsf(bytes);
  let dropped = 0;
  const text = file.labels
    .map((label) => {
      dropped +=
        Math.max(0, label.strings.length - 1) +
        (label.strings[0]?.speech ? 1 : 0);

      return [
        label.name,
        ...(label.strings.length
          ? [quoteStringText(label.strings[0].text)]
          : []),
        'END',
        '',
      ].join(eol);
    })
    .join(eol);

  return { text, dropped, unencodable: unencodableCharacters(text) };
};

/** A `.csf` from a `.str` file's text, every record in order */
export const strToCsf = (source: string): Uint8Array =>
  writeCsf({
    version: 3,
    reserved: 0,
    language: 0,
    labels: parseStringRecords(source).map((record) => ({
      name: record.label,
      strings: record.text === undefined ? [] : [{ text: record.text }],
    })),
  });

export const registerSageStrLanguage = (
  context: vscode.ExtensionContext,
  archiveModel: ArchiveModel,
): void => {
  const diagnostics = vscode.languages.createDiagnosticCollection(STR_LANGUAGE);
  const refresh = (document: vscode.TextDocument) => {
    if (document.languageId !== STR_LANGUAGE) {
      return;
    }

    diagnostics.set(
      document.uri,
      findStrProblems(document.getText()).map((problem) => {
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(
            document.positionAt(problem.start),
            document.positionAt(problem.end),
          ),
          problem.message,
          problem.isError
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning,
        );

        diagnostic.source = 'bigFS';

        return diagnostic;
      }),
    );
  };

  vscode.workspace.textDocuments.forEach(refresh);

  const convert = async (target?: CommandTarget) => {
    const source =
      toUri(target) ?? vscode.window.activeTextEditor?.document.uri;

    if (!source) {
      return;
    }

    const isCsf = /\.csf$/i.test(source.path);
    const output = source.with({
      path: source.path.replace(/\.(csf|str)$/i, isCsf ? '.str' : '.csf'),
    });
    const exists = await vscode.workspace.fs.stat(output).then(
      () => true,
      () => false,
    );

    if (
      exists &&
      (await vscode.window.showWarningMessage(
        `${output.path.slice(output.path.lastIndexOf('/') + 1)} exists. Replace it?`,
        { modal: true },
        'Replace',
      )) !== 'Replace'
    ) {
      return;
    }

    const bytes = await vscode.workspace.fs.readFile(source);

    if (isCsf) {
      const { text, dropped, unencodable } = csfToStr(bytes);

      await vscode.workspace.fs.writeFile(
        output,
        encodeWindows1252(text, 0x3f),
      );

      if (unencodable.length) {
        void vscode.window.showWarningMessage(
          `The .str file is Windows-1252, which lacks ${unencodable
            .slice(0, 8)
            .map((char) => JSON.stringify(char))
            .join(' ')}${unencodable.length > 8 ? ' and more' : ''}; ${
            unencodable.length === 1 ? 'it was' : 'they were'
          } written as ?.`,
        );
      }

      if (dropped) {
        void vscode.window.showInformationMessage(
          `${dropped} speech names or extra strings have no place in a .str file and were left out.`,
        );
      }
    } else {
      await vscode.workspace.fs.writeFile(
        output,
        strToCsf(decodeIniText(bytes)),
      );
    }

    await vscode.commands.executeCommand('vscode.open', output);
  };

  context.subscriptions.push(
    diagnostics,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) =>
      refresh(event.document),
    ),
    vscode.workspace.onDidCloseTextDocument((document) =>
      diagnostics.delete(document.uri),
    ),
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols: (document) =>
        parseStringRecords(document.getText()).map((record) => {
          const range = new vscode.Range(
            document.positionAt(record.span.start),
            document.positionAt(
              Math.max(record.span.start, record.span.end - 1),
            ),
          );
          const name = new vscode.Range(
            document.positionAt(record.labelSpan.start),
            document.positionAt(record.labelSpan.end),
          );

          return new vscode.DocumentSymbol(
            record.label,
            record.text ?? '',
            vscode.SymbolKind.String,
            range,
            name,
          );
        }),
    }),
    vscode.languages.registerFoldingRangeProvider(selector, {
      provideFoldingRanges: (document) =>
        parseStringRecords(document.getText()).flatMap((record) => {
          const start = document.positionAt(record.span.start).line;
          const end = document.positionAt(
            Math.max(record.span.start, record.span.end - 1),
          ).line;

          return end > start ? [new vscode.FoldingRange(start, end)] : [];
        }),
    }),
    vscode.commands.registerCommand('bigfs.convertStringTable', convert),
    registerTranslationCheck(archiveModel),
  );
};
