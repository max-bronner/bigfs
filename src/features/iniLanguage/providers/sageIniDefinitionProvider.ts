import { Position, Range } from 'vscode';
import type { DefinitionProvider, LocationLink } from 'vscode';
import type { SageIniDocuments } from '../../../services/ini/sageIniDocuments';
import type { SageIniIndex } from '../../../services/ini/sageIniIndex';
import { resolveSageSymbol } from '../../../formats/ini/sageIniSymbol';
import { includeExists, resolveIncludeUri } from '../../../services/ini/sageIniInclude';

/** Past the end of any real line, clamped by the editor against the document */
const LINE_END = 4096;

/**
 * Creates the definition provider, which follows a reference to the block
 * that declares it, across every open archive.
 *
 * Which namespace a value resolves into depends on the field it sits on:
 * `Weapon = PRIMARY GondorBow` points into `Weapon`, while `Armor = DEFAULT
 * 100%` points nowhere at all. Several fields are polymorphic - `Sound` takes
 * an `AudioEvent` or a `Multisound` - so every candidate namespace is tried
 * and whichever holds the name answers.
 *
 * Results are `LocationLink`s rather than plain locations, because the link
 * carries a target range separate from the line to reveal. That is what the
 * editor renders when a reference is ctrl-hovered: given the whole block it
 * previews the definition, given a bare line it previews only that line.
 */
export const createSageIniDefinitionProvider = (
  documents: SageIniDocuments,
  index: SageIniIndex,
): DefinitionProvider => ({
  async provideDefinition(document, position) {
    const [parsed, schema] = await Promise.all([
      documents.parse(document),
      documents.getSchema(),
    ]);

    // An include names a file rather than a symbol, and resolving it needs no
    // index at all - the path is relative to the document holding it
    const include = parsed.includes.find(
      ({ line, start, end }) =>
        line === position.line &&
        position.character >= start &&
        position.character <= end,
    );

    if (include) {
      const target = resolveIncludeUri(document.uri, include.path);

      // A mod can reference a file it does not ship, so a dead path offers
      // nothing rather than a link to nowhere
      if (!(await includeExists(target))) {
        return undefined;
      }

      return [
        {
          originSelectionRange: new Range(
            new Position(include.line, include.start),
            new Position(include.line, include.end),
          ),
          targetUri: target,
          targetRange: new Range(new Position(0, 0), new Position(0, 0)),
          targetSelectionRange: new Range(
            new Position(0, 0),
            new Position(0, 0),
          ),
        },
      ];
    }

    const symbol = resolveSageSymbol(
      parsed,
      schema,
      position.line,
      position.character,
    );

    if (!symbol) {
      return undefined;
    }

    // A lookup is only trustworthy once every archive has been read
    await index.whenReady();

    // A macro reference is written exactly like a cross reference, and the
    // engine substitutes it before anything else reads the value, so the
    // macro table answers first
    const macro = index.findMacro(symbol.name);

    if (macro) {
      return [
        {
          originSelectionRange: new Range(
            new Position(symbol.line, symbol.token.start),
            new Position(symbol.line, symbol.token.end),
          ),
          targetUri: macro.uri,
          targetRange: new Range(
            new Position(macro.line, 0),
            new Position(macro.line, LINE_END),
          ),
          targetSelectionRange: new Range(
            new Position(macro.line, 0),
            new Position(macro.line, LINE_END),
          ),
        },
      ];
    }

    const found = symbol.namespaces.flatMap((namespace) =>
      index.findDefinitions(namespace, symbol.name),
    );

    // Two entries can declare the same name, but the same entry recorded twice
    // would turn a jump into a picker, so identical places collapse
    const places = found.filter(
      (place, at) =>
        found.findIndex(
          (other) =>
            other.line === place.line &&
            other.uri.toString() === place.uri.toString(),
        ) === at,
    );

    // The token under the cursor, which the editor underlines on ctrl-hover
    const originSelectionRange = new Range(
      new Position(symbol.line, symbol.token.start),
      new Position(symbol.line, symbol.token.end),
    );

    return places.map(
      ({ uri, line, endLine }): LocationLink => ({
        originSelectionRange,
        targetUri: uri,
        // The whole block, which is what the preview shows
        targetRange: new Range(
          new Position(line, 0),
          new Position(endLine, LINE_END),
        ),
        // The header alone, which is what a jump reveals and selects
        targetSelectionRange: new Range(
          new Position(line, 0),
          new Position(line, LINE_END),
        ),
      }),
    );
  },
});
