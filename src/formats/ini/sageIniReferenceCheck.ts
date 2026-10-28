import { isAudioSentinel, referencedNames } from './sageAudioValues';
import { CONSTANT_NAME } from './sageReferenceFields';
import type { SageDocument } from './sageIniParser';
import type { SageIniSchema } from './sageIniSchema';

/**
 * Which values of a document name a definition that does not exist. The
 * editor wraps the answer in diagnostics; the questions it needs from the
 * index are the three of `ReferenceLookup`, so the check runs in the unit
 * tests against a table built in code.
 */

/** What the check asks of the index */
export interface ReferenceLookup {
  findMacro(name: string): unknown;
  findDefinitions(namespace: string, name: string): readonly unknown[];
  countDefinitions(namespace: string): number;
}

/** A value that names nothing defined */
export interface UnresolvedReference {
  name: string;
  line: number;
  start: number;
  end: number;
  namespaces: readonly string[];
}

/**
 * How many definitions a namespace must hold before `auto` checks references
 * into it: enough that the base game's files are indexed, so a name missing
 * from it is a mistake rather than a file the workspace does not hold
 */
export const AUTO_CHECK_MINIMUM = 50;

/**
 * Values that are never a definition's name: numbers and percentages,
 * SCREAMING_SNAKE words (enum values and macros), string labels with a
 * colon, and the `NONE` many fields accept. Case sensitive: `HumanArmor` is
 * a name, `HUMAN_ARMOR` is a word of the engine's vocabulary.
 */
const NOT_A_NAME = new RegExp(
  `^(?:[+-]?[\\d.]+%?|${CONSTANT_NAME.source.slice(1, -1)}|[^:]+:.*|[Nn][Oo][Nn][Ee])$`,
);

export const isNotAName = (value: string): boolean => NOT_A_NAME.test(value);

/**
 * Every value of a reference field that names nothing in any namespace the
 * field can point into. `isOn` checks every namespace whatever is indexed;
 * otherwise a namespace is only trusted once enough of it is.
 */
export const findUnresolvedReferences = (
  parsed: SageDocument,
  schema: SageIniSchema,
  lookup: ReferenceLookup,
  isOn: boolean,
): UnresolvedReference[] => {
  const unresolved: UnresolvedReference[] = [];

  for (const statement of parsed.statements) {
    for (const reference of referencedNames(statement, schema)) {
      // A sound's namespaces are one group, since which kind holds a name is
      // not something the field says; any other field is checked per
      // namespace, as each one is only trusted once enough is indexed
      const namespaces = reference.isAudio
        ? reference.namespaces
        : reference.namespaces.filter(
            (namespace) =>
              isOn || lookup.countDefinitions(namespace) >= AUTO_CHECK_MINIMUM,
          );
      const isTrusted =
        isOn ||
        !reference.isAudio ||
        namespaces.reduce(
          (sum, namespace) => sum + lookup.countDefinitions(namespace),
          0,
        ) >= AUTO_CHECK_MINIMUM;

      if (
        !namespaces.length ||
        !isTrusted ||
        (reference.isAudio
          ? isAudioSentinel(reference.name)
          : isNotAName(reference.name)) ||
        lookup.findMacro(reference.name) ||
        namespaces.some(
          (namespace) => lookup.findDefinitions(namespace, reference.name).length,
        )
      ) {
        continue;
      }

      unresolved.push({
        name: reference.name,
        line: statement.line,
        start: reference.start,
        end: reference.end,
        namespaces,
      });
    }
  }

  return unresolved;
};
