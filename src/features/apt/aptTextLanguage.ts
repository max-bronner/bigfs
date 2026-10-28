import * as vscode from 'vscode';
import { parseMovieText, textBlocks } from '../../formats/apt/movieText';
import type { CharacterText, FrameText } from '../../formats/apt/movieText';

/**
 * Editor features of the `apt-text` language: an outline of the movie's
 * characters and frames, folding by block, and hover and go to definition
 * on a character id, which lead from any line that names a character to the
 * line that declares it.
 */

const SELECTOR: vscode.DocumentSelector = { language: 'apt-text' };

const lineRange = (document: vscode.TextDocument, start = 0, end = start) =>
  new vscode.Range(
    start,
    0,
    Math.min(end, document.lineCount - 1),
    document.lineAt(Math.min(end, document.lineCount - 1)).text.length,
  );

const frameSymbol = (
  document: vscode.TextDocument,
  frame: FrameText,
): vscode.DocumentSymbol => {
  const labels = frame.items.flatMap((item) =>
    item.type === 'label' ? [item.label] : [],
  );
  const range = lineRange(document, frame.line, frame.endLine);

  return new vscode.DocumentSymbol(
    `frame ${frame.index}`,
    labels.join(', '),
    vscode.SymbolKind.Event,
    range,
    lineRange(document, frame.line),
  );
};

const characterSymbol = (
  document: vscode.TextDocument,
  character: CharacterText,
): vscode.DocumentSymbol => {
  const symbol = new vscode.DocumentSymbol(
    `${character.id} ${character.type}`,
    character.type === 'editText'
      ? (character.variable ?? character.text ?? '')
      : character.type === 'font'
        ? (character.name ?? '')
        : '',
    character.type === 'sprite' || character.type === 'movie'
      ? vscode.SymbolKind.Class
      : vscode.SymbolKind.Object,
    lineRange(document, character.line, character.endLine),
    lineRange(document, character.line),
  );

  if (character.type === 'sprite' || character.type === 'movie') {
    symbol.children = character.frames.map((frame) =>
      frameSymbol(document, frame),
    );
  }
  return symbol;
};

/** Where the character an id names is declared, and the id under the cursor */
const idAt = (document: vscode.TextDocument, position: vscode.Position) => {
  const parsed = parseMovieText(document.getText());
  const site = parsed.ids.find(
    (each) =>
      each.line === position.line &&
      position.character >= each.column &&
      position.character <= each.endColumn,
  );

  if (!site) {
    return undefined;
  }

  const declaration = parsed.ids.find(
    (each) => each.isDeclaration && each.id === site.id,
  );

  return {
    site,
    declaration,
    character: parsed.movie.characters[site.id],
  };
};

export const registerAptTextLanguage = (): vscode.Disposable =>
  vscode.Disposable.from(
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, {
      provideDocumentSymbols(document) {
        const { movie } = parseMovieText(document.getText());
        const lines = (items: { line?: number }[]) =>
          items.flatMap((item) => (item.line === undefined ? [] : [item.line]));
        const group = (name: string, at: number[], kind: vscode.SymbolKind) =>
          at.length
            ? [
                new vscode.DocumentSymbol(
                  name,
                  `${at.length}`,
                  kind,
                  lineRange(document, Math.min(...at), Math.max(...at)),
                  lineRange(document, Math.min(...at)),
                ),
              ]
            : [];

        return [
          ...group('const', lines(movie.constants), vscode.SymbolKind.Constant),
          ...group('imports', lines(movie.imports), vscode.SymbolKind.Module),
          ...group(
            'exports',
            lines(movie.exports),
            vscode.SymbolKind.Interface,
          ),
          ...movie.characters
            .filter((character) => character.line !== undefined)
            .map((character) => characterSymbol(document, character)),
        ];
      },
    }),
    vscode.languages.registerFoldingRangeProvider(SELECTOR, {
      provideFoldingRanges(document) {
        return textBlocks(document.getText()).map(
          (block) => new vscode.FoldingRange(block.start, block.end),
        );
      },
    }),
    vscode.languages.registerDefinitionProvider(SELECTOR, {
      provideDefinition(document, position) {
        const found = idAt(document, position);

        if (!found?.declaration) {
          return undefined;
        }
        return [
          {
            originSelectionRange: new vscode.Range(
              found.site.line,
              found.site.column,
              found.site.line,
              found.site.endColumn,
            ),
            targetUri: document.uri,
            targetRange: lineRange(
              document,
              found.declaration.line,
              found.character?.endLine ?? found.declaration.line,
            ),
            targetSelectionRange: new vscode.Range(
              found.declaration.line,
              found.declaration.column,
              found.declaration.line,
              found.declaration.endColumn,
            ),
          },
        ];
      },
    }),
    vscode.languages.registerHoverProvider(SELECTOR, {
      provideHover(document, position) {
        const found = idAt(document, position);

        if (!found) {
          return undefined;
        }

        const range = new vscode.Range(
          found.site.line,
          found.site.column,
          found.site.line,
          found.site.endColumn,
        );

        if (!found.declaration) {
          return new vscode.Hover(
            `Character ${found.site.id} is not declared in this movie`,
            range,
          );
        }

        const markdown = new vscode.MarkdownString();

        markdown.appendCodeblock(
          document.lineAt(found.declaration.line).text.trim(),
          'apt-text',
        );
        return new vscode.Hover(markdown, range);
      },
    }),
  );
