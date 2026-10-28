import { Position, Range, WorkspaceEdit } from 'vscode';
import type { RenameProvider, TextDocument } from 'vscode';
import type { SageIniDocuments } from '../sageIniDocuments';
import type { SageIniIndex } from '../sageIniIndex';
import { resolveSageSymbol } from '../../formats/ini/sageIniSymbol';

/**
 * Renames a definition and every value that names it, across every archive
 * and loose file, or a `#define` and every use of it. Edits to entries inside
 * an archive are written back through the archive, like any other save.
 *
 * Registering this is what makes VS Code's own Rename Symbol (F2) work on an
 * `Object`, a `Weapon` or any other name the index knows.
 */

/** What a name may become: one token, which no separator or comment can split */
const NAME_PATTERN = /^[^\s=;"]+$/;

/** Ranges of the name a position sits on, and what the name is */
const findSymbol = async (
  documents: SageIniDocuments,
  document: TextDocument,
  position: Position,
) => {
  const [parsed, schema] = await Promise.all([
    documents.parse(document),
    documents.getSchema(),
  ]);
  const defined = parsed.macros.find(
    ({ line, start, end }) =>
      line === position.line &&
      position.character >= start &&
      position.character <= end,
  );

  if (defined) {
    return {
      name: defined.name,
      namespaces: [] as readonly string[],
      range: new Range(defined.line, defined.start, defined.line, defined.end),
    };
  }

  const symbol = resolveSageSymbol(
    parsed,
    schema,
    position.line,
    position.character,
  );

  return (
    symbol && {
      name: symbol.name,
      namespaces: symbol.namespaces,
      range: new Range(
        symbol.line,
        symbol.token.start,
        symbol.line,
        symbol.token.end,
      ),
    }
  );
};

/** Creates the provider over the shared parse and the cross-archive index */
export const createSageIniRenameProvider = (
  documents: SageIniDocuments,
  index: SageIniIndex,
): RenameProvider => ({
  async prepareRename(document, position) {
    const symbol = await findSymbol(documents, document, position);

    if (
      !symbol ||
      (!symbol.namespaces.length && !index.findMacro(symbol.name))
    ) {
      throw new Error(
        'Only a definition, a reference or a macro can be renamed',
      );
    }

    return { range: symbol.range, placeholder: symbol.name };
  },

  async provideRenameEdits(document, position, newName) {
    if (!NAME_PATTERN.test(newName)) {
      throw new Error(`'${newName}' cannot be a name: it would split the line`);
    }

    const symbol = await findSymbol(documents, document, position);

    if (!symbol) {
      return undefined;
    }

    // A rename is only complete once every archive has been read, and it
    // edits what the open documents hold now, not what was last saved
    await index.whenReady();
    await index.syncOpenDocuments();

    const edit = new WorkspaceEdit();
    const replace = (place: {
      uri: TextDocument['uri'];
      line: number;
      start: number;
      end: number;
    }) =>
      edit.replace(
        place.uri,
        new Range(place.line, place.start, place.line, place.end),
        newName,
      );

    const macro = index.findMacro(symbol.name);

    if (macro) {
      replace(macro);
      index.findMacroUses(symbol.name).forEach(replace);

      return edit;
    }

    for (const namespace of symbol.namespaces) {
      index.findDefinitions(namespace, symbol.name).forEach(replace);
      index.findReferences(namespace, symbol.name).forEach(replace);
    }

    return edit;
  },
});
