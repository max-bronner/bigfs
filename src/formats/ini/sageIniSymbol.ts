import { declarationOf, parentOf } from './sageIniNames';
import { referencedNames } from '../../language/model/sageAudioValues';
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

  // A block header declares a name, in the namespace its keyword makes; the
  // position may be on either the keyword or the name itself. A
  // `ChildObject` header's second value is not a declaration but the object
  // it inherits from.
  if (statement.block) {
    const declaration = declarationOf(statement, schema);
    const parent = parentOf(statement);

    if (parent && token === parent.token) {
      return {
        token,
        line,
        name: token.text,
        namespaces: [parent.namespace],
        isDeclaration: false,
      };
    }

    if (
      !declaration ||
      (token !== statement.keyword && token !== declaration.name)
    ) {
      return undefined; // a header that declares nothing, or a value of it that is no name
    }

    return {
      token: declaration.name,
      line,
      name: declaration.name.text,
      namespaces: [declaration.namespace],
      isDeclaration: true,
    };
  }

  if (token === statement.keyword) {
    return undefined; // a field name rather than a value
  }

  // A sound or announcer field names its sounds inside its values, so the
  // symbol is the name alone: not the `EVA:` before it, nor the weight after
  const inside = referencedNames(statement, schema).find(
    (candidate) => character >= candidate.start && character <= candidate.end,
  );

  if (
    inside &&
    (inside.isAudio || inside.start !== token.start || inside.end !== token.end)
  ) {
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
      statement.values.indexOf(token),
    ),
    isDeclaration: false,
  };
};
