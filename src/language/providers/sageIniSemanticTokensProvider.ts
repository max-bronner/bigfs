import { SemanticTokensLegend, SemanticTokensBuilder } from 'vscode';
import type { DocumentSemanticTokensProvider } from 'vscode';
import type { SageIniDocuments } from '../sageIniDocuments';
import type { SageIniSchema } from '../model/sageIniSchema';
import type { SageStatement, SageToken } from '../model/sageIniParser';

/**
 * Marks the tokens a TextMate grammar cannot decide.
 *
 * Whether `Color` names a particle module slot or a colour field, and whether
 * `Wind` opens a block or is the start of `WindowTransition`, depend on the
 * schema and on where the line sits. A grammar that guesses gets both wrong, so
 * the grammar stays context free and everything that needs the parse is
 * decided here, where the block tree is already known.
 */

/**
 * Token types this provider emits. `defaultLibrary` marks a name the engine
 * itself defines, which is what tells a reader that a field is engine
 * supported rather than merely present in the data; `deprecated` marks one the
 * engine no longer reads.
 */
export const SAGE_INI_LEGEND = new SemanticTokensLegend(
  [
    'type', // a block keyword
    'class', // a module type, or a definition name
    'label', // a module tag
    'property', // a leaf field name
    'variable', // a value that references a definition elsewhere
    'enumMember', // a SCREAMING_SNAKE value
    'parameter', // a keyed component of a coordinate or a colour
    'number',
  ],
  ['defaultLibrary', 'deprecated', 'declaration'],
);

const SCREAMING_SNAKE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const NUMERIC = /^[-+]?\d+(?:\.\d+)?%?$/;
const COMPONENT = /^([A-Za-z_][A-Za-z0-9_]*):(.*)$/;

/** Engine types whose value is a set of keyed components rather than one token */
const COMPONENT_TYPES = new Set(['Coord3D', 'Color', 'NumPair']);

/**
 * Marks the values of one statement. A value is read against the field's
 * engine type where there is one, because that is what says whether `R:255` is
 * a colour channel or an unrelated sub-key.
 */
const addValues = (
  builder: SemanticTokensBuilder,
  statement: SageStatement,
  schema: SageIniSchema,
): void => {
  const engineField = schema.getEngineField(statement.keyword.text);
  const references = schema.getReferenceNamespaces(statement.keyword.text);
  const hasComponents =
    engineField !== undefined && COMPONENT_TYPES.has(engineField.type);

  const mark = (token: SageToken, type: string, modifiers: string[] = []) =>
    builder.push(
      statement.line,
      token.start,
      token.end - token.start,
      SAGE_INI_LEGEND.tokenTypes.indexOf(type),
      modifiers.reduce(
        (bits, name) =>
          bits | (1 << SAGE_INI_LEGEND.tokenModifiers.indexOf(name)),
        0,
      ),
    );

  statement.values.forEach((token) => {
    const component = COMPONENT.exec(token.text);

    if (hasComponents && component) {
      // Mark only the key; the grammar already colours the number after it
      mark(
        { text: component[1], start: token.start, end: token.start + component[1].length },
        'parameter',
      );

      return;
    }

    if (NUMERIC.test(token.text)) {
      mark(token, 'number');
      return;
    }

    if (references.length) {
      mark(token, 'variable');
      return;
    }

    if (SCREAMING_SNAKE.test(token.text)) {
      mark(token, 'enumMember');
    }
  });
};

/** Creates the provider, sharing the one parse and schema every provider uses */
export const createSageIniSemanticTokensProvider = (
  documents: SageIniDocuments,
): DocumentSemanticTokensProvider => ({
  async provideDocumentSemanticTokens(document) {
    const [{ statements }, schema] = await Promise.all([
      documents.parse(document),
      documents.getSchema(),
    ]);
    const builder = new SemanticTokensBuilder(SAGE_INI_LEGEND);

    const mark = (
      line: number,
      token: SageToken,
      type: string,
      modifiers: string[] = [],
    ) =>
      builder.push(
        line,
        token.start,
        token.end - token.start,
        SAGE_INI_LEGEND.tokenTypes.indexOf(type),
        modifiers.reduce(
          (bits, name) =>
            bits | (1 << SAGE_INI_LEGEND.tokenModifiers.indexOf(name)),
          0,
        ),
      );

    statements.forEach((statement) => {
      const { block, keyword, line } = statement;

      if (!block) {
        const engineField = schema.getEngineField(keyword.text);

        mark(line, keyword, 'property', [
          ...(engineField ? ['defaultLibrary'] : []),
          ...(engineField && !engineField.used ? ['deprecated'] : []),
        ]);

        addValues(builder, statement, schema);

        return;
      }

      mark(line, keyword, 'type', [
        ...(schema.isEngineBlock(keyword.text) ? ['defaultLibrary'] : []),
      ]);

      if (block.moduleType) {
        mark(line, statement.values[0], 'class');

        if (statement.values[1]) {
          mark(line, statement.values[1], 'label');
        }

        return;
      }

      // A root block's remaining tokens name the definition it declares
      statement.values.forEach((token, at) =>
        mark(
          line,
          token,
          'class',
          at === 0 && statement.context === '<root>' ? ['declaration'] : [],
        ),
      );
    });

    return builder.build();
  },
});
