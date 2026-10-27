import { FRAGMENT_CONTEXT, ROOT_CONTEXT } from './sageIniSchema';
import { referencedNames } from './sageAudioValues';
import type { SageIniSchema } from './sageIniSchema';
import type { SageDocument, SageStatement, SageToken } from './sageIniParser';

/**
 * What name sits under a position, and which namespaces it belongs to.
 *
 * Navigation works in both directions off the same answer. On the name of a
 * block at file scope this is a declaration, so the interesting question is
 * what uses it; on the value of a reference field it is a use, so the
 * interesting question is where it is declared. Both need the same thing
 * first: the token, and what namespace it is a name in.
 */
export interface SageSymbol {
  /** The token under the position */
  token: SageToken;
  line: number;
  /** The name, which is the token text */
  name: string;
  /**
   * Namespaces the name could belong to. A reference field can be
   * polymorphic - `Sound` takes an `AudioEvent` or a `Multisound` - so every
   * candidate is carried and the caller tries each.
   */
  namespaces: readonly string[];
  /** Whether the position is on the declaration rather than on a use */
  isDeclaration: boolean;
}

/** The token of a statement a column sits on, if any */
const tokenAt = (
  statement: SageStatement,
  character: number,
): SageToken | undefined =>
  [statement.keyword, ...statement.values].find(
    (token) => character >= token.start && character <= token.end,
  );

/**
 * Resolves the name under a position, or nothing when the position is not on
 * one - a leaf value such as `Armor = DEFAULT 100%` names no definition, and
 * neither does a field name that is not a reference.
 */
export const resolveSageSymbol = (
  { statements }: SageDocument,
  schema: SageIniSchema,
  line: number,
  character: number,
): SageSymbol | undefined => {
  const statement = statements.find((candidate) => candidate.line === line);

  if (!statement) {
    return undefined;
  }

  const token = tokenAt(statement, character);

  if (!token) {
    return undefined;
  }

  // A block at file scope declares a name; its keyword is the namespace, and
  // the position may be on either the keyword or the name itself
  const isFileScope =
    statement.context === ROOT_CONTEXT ||
    (statement.context === FRAGMENT_CONTEXT &&
      schema.isEngineBlock(statement.keyword.text));

  if (statement.block && isFileScope) {
    const name = statement.values[0];

    if (!name) {
      return undefined;
    }

    return {
      token: token === statement.keyword ? name : token,
      line,
      name: token === statement.keyword ? name.text : token.text,
      namespaces: [statement.keyword.text],
      isDeclaration: true,
    };
  }

  if (statement.block || token === statement.keyword) {
    return undefined; // a nested block header, or a field name rather than a value
  }

  // A sound or announcer field names its sounds inside its values, so the
  // symbol is the name alone: not the `EVA:` before it, nor the weight after
  const inside = referencedNames(statement, schema).find(
    (candidate) => character >= candidate.start && character <= candidate.end,
  );

  if (inside?.isAudio) {
    return {
      token: { text: inside.name, start: inside.start, end: inside.end },
      line,
      name: inside.name,
      namespaces: inside.namespaces,
      isDeclaration: false,
    };
  }

  // Every value is returned, even one whose field references no namespace: a
  // macro can stand in for any value at all, and only the macro table knows.
  return {
    token,
    line,
    name: token.text,
    namespaces: schema.getReferenceNamespaces(
      statement.keyword.text,
      statement.context,
    ),
    isDeclaration: false,
  };
};
