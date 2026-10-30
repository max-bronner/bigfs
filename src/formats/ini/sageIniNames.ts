import { FRAGMENT_CONTEXT, ROOT_CONTEXT } from './sageIniSchema';
import type { SageIniSchema } from './sageIniSchema';
import type { SageStatement, SageToken } from './sageIniParser';
import { toCanonicalNamespace, getParentNamespace } from './sageReferenceFields';

/**
 * Which block headers declare a name, and which of their values name another
 * definition. The index and the symbol resolver both ask, so a name is a
 * declaration in exactly the same places for finding it and for renaming it.
 *
 * This file knows nothing of the editor, so it runs in the unit tests.
 */

/** A name a block header declares */
export interface Declaration {
  /** The token that holds the name */
  name: SageToken;
  /** The namespace it is declared in, aliases folded */
  namespace: string;
}

/**
 * Block kinds that, written inside another block, are not definitions of
 * their own namespace. A `LivingWorldArmyIcon` nests an `Object` block to
 * override auto-resolve tables of an object defined elsewhere.
 */
const NOT_NESTED_DEFINITIONS: ReadonlySet<string> = new Set(['object']);

/**
 * Gets the name a block statement declares, if it declares one.
 *
 * A block at file scope declares a name in the namespace of its keyword. So
 * does a block nested elsewhere when its keyword is a kind some reference
 * field can name: a campaign's `Region`, which eleven fields point to, and an
 * `InGameUI`'s `RadiusCursorTemplate`. That is read off the reference table,
 * so a title or a mod that nests another kind of definition gets it too.
 */
export const getDeclaration = (
  statement: Pick<SageStatement, 'block' | 'context' | 'keyword' | 'values'>,
  schema: SageIniSchema,
): Declaration | undefined => {
  const [name] = statement.values;

  if (!statement.block || !name) {
    return undefined;
  }

  const { context, keyword } = statement;
  const isFileScope =
    context === ROOT_CONTEXT ||
    (context === FRAGMENT_CONTEXT && schema.isEngineBlock(keyword.text));
  const namespace = toCanonicalNamespace(keyword.text);

  if (
    isFileScope ||
    (!NOT_NESTED_DEFINITIONS.has(namespace.toLowerCase()) &&
      !schema.isModuleSlot(keyword.text) &&
      schema.isReferenceNamespace(keyword.text))
  ) {
    return { name, namespace };
  }

  return undefined;
};

/** Gets the parent a `ChildObject` or `ObjectReskin` header inherits from */
export const getParent = (
  statement: Pick<SageStatement, 'block' | 'keyword' | 'values'>,
): { token: SageToken; namespace: string } | undefined => {
  const namespace = getParentNamespace(statement.keyword.text);
  const token = statement.values[1];

  return statement.block && namespace && token
    ? { token, namespace }
    : undefined;
};
