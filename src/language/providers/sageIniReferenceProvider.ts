import { Location, Position, Range } from 'vscode';
import type { ReferenceProvider } from 'vscode';
import type { SageIniDocuments } from '../sageIniDocuments';
import type { SageIniIndex } from '../sageIniIndex';
import { resolveSageSymbol } from '../model/sageIniSymbol';

/**
 * Answers "what uses this", across every open archive.
 *
 * Registering this is what puts VS Code's own Go to References, Find All
 * References and the reference peek in front of the user - the editor builds
 * those on a reference provider, so nothing custom is contributed.
 *
 * It works from either end. On `Object GondorArcher` it finds every field that
 * names it; on a `Weapon = PRIMARY GondorBow` value it finds every other place
 * that names the same weapon. That is the question modders currently answer
 * with grep across an extracted install.
 */
export const createSageIniReferenceProvider = (
  documents: SageIniDocuments,
  index: SageIniIndex,
): ReferenceProvider => ({
  async provideReferences(document, position, context) {
    const [parsed, schema] = await Promise.all([
      documents.parse(document),
      documents.getSchema(),
    ]);

    // The cursor may be on the `#define` itself, which is not a statement and
    // so has no symbol; from there the question is still what uses it
    const defined = parsed.macros.find(
      ({ line, start, end }) =>
        line === position.line &&
        position.character >= start &&
        position.character <= end,
    );

    const symbol = defined
      ? { name: defined.name, namespaces: [] as readonly string[] }
      : resolveSageSymbol(parsed, schema, position.line, position.character);

    if (!symbol) {
      return undefined;
    }

    // A lookup is only complete once every archive has been read
    await index.whenReady();

    // A macro is resolved before any namespace, the way the engine substitutes
    // it, so its uses are what "what uses this" means for one
    const macro = index.findMacro(symbol.name);

    if (macro) {
      const uses = index.findMacroUses(symbol.name).map(
        ({ uri, line, start, end }) =>
          new Location(
            uri,
            new Range(new Position(line, start), new Position(line, end)),
          ),
      );

      return context.includeDeclaration
        ? [
            new Location(
              macro.uri,
              new Range(
                new Position(macro.line, 0),
                new Position(macro.line, 0),
              ),
            ),
            ...uses,
          ]
        : uses;
    }

    const uses = symbol.namespaces.flatMap((namespace) =>
      index.findReferences(namespace, symbol.name),
    );

    const locations = uses.map(
      ({ uri, line, start, end }) =>
        new Location(
          uri,
          new Range(new Position(line, start), new Position(line, end)),
        ),
    );

    if (!context.includeDeclaration) {
      return locations;
    }

    const declarations = symbol.namespaces.flatMap((namespace) =>
      index.findDefinitions(namespace, symbol.name),
    );

    return [
      ...declarations.map(
        ({ uri, line }) =>
          new Location(
            uri,
            new Range(new Position(line, 0), new Position(line, 0)),
          ),
      ),
      ...locations,
    ];
  },
});
