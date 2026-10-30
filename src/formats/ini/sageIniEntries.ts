import { findAssetReferences } from './sageIniAssets';
import { findReferencedNames } from './sageAudioValues';
import { getDeclaration } from './sageIniNames';
import { CONSTANT_NAME } from './sageReferenceFields';
import { isFragmentPath, parseSageIni } from './sageIniParser';
import type { SageIniSchema } from './sageIniSchema';

/**
 * Everything one INI file contributes to the workspace index: the names it
 * declares, the names its values use, its macros and where each is used. The
 * index adds the file's address and keeps the tables; reading the entries off
 * the parse is the part that has to be right, and this file knows nothing of
 * the editor, so it runs in the unit tests.
 */

/**
 * The namespace models and animations are recorded under, by lowercased
 * file name: not a definition keyword, so nothing else looks it up
 */
export const FILE_USES = '#file';

/** A block that declares a name */
export interface EntryDefinition {
  /** Where lookups find it: the keyword's namespace, aliases folded */
  namespace: string;
  /** The block keyword as written */
  keyword: string;
  name: string;
  line: number;
  endLine: number;
  start: number;
  end: number;
}

/** A value that names a definition elsewhere */
export interface EntryReference {
  namespace: string;
  name: string;
  line: number;
  start: number;
  end: number;
  field: string;
}

/** Macro a file defines with `#define` */
export interface EntryMacro {
  name: string;
  value: string;
  line: number;
  start: number;
  end: number;
}

/** A SCREAMING_SNAKE word written somewhere, which may turn out to be a macro */
export interface EntryConstantUse {
  /** Lowercased */
  key: string;
  line: number;
  start: number;
  end: number;
  field: string;
}

/** A token of a macro's body, which stands wherever the macro is written */
export interface EntryBodyToken {
  /** The macro whose body holds it, lowercased */
  macro: string;
  /** Lowercased, so a name finds the macros that spell it */
  text: string;
  line: number;
  start: number;
  end: number;
}

/** Index entries one INI or fragment file contributes, as `collectEntries` reads them */
export interface FileEntries {
  definitions: EntryDefinition[];
  references: EntryReference[];
  macros: EntryMacro[];
  constantUses: EntryConstantUse[];
  bodyTokens: EntryBodyToken[];
}

/** Pattern of a macro body token: anything between whitespace, commas and call parentheses */
const BODY_TOKEN = /[^\s,()]+/g;

/** Reads one INI or fragment file's entries */
export const collectEntries = (
  text: string,
  entryPath: string,
  schema: SageIniSchema,
): FileEntries => {
  const parsed = parseSageIni(text.split(/\r?\n/), schema, {
    isFragment: isFragmentPath(entryPath),
  });
  const entries: FileEntries = {
    definitions: [],
    references: [],
    macros: [],
    constantUses: [],
    bodyTokens: [],
  };

  for (const macro of parsed.macros) {
    const macroKey = macro.name.toLowerCase();

    entries.macros.push({
      name: macro.name,
      value: macro.value,
      line: macro.line,
      start: macro.start,
      end: macro.end,
    });

    for (const match of macro.value.matchAll(BODY_TOKEN)) {
      const start = macro.valueStart + match.index;
      const end = start + match[0].length;

      if (match[0].startsWith('#')) {
        continue; // a call such as `#ADD`, not a token that stands for a value
      }

      entries.bodyTokens.push({
        macro: macroKey,
        text: match[0].toLowerCase(),
        line: macro.line,
        start,
        end,
      });

      if (CONSTANT_NAME.test(match[0])) {
        entries.constantUses.push({
          key: match[0].toLowerCase(),
          line: macro.line,
          start,
          end,
          field: `#define ${macro.name}`,
        });
      }
    }
  }

  for (const statement of parsed.statements) {
    const { block, keyword, line, values } = statement;
    const declaration = getDeclaration(statement, schema);

    if (block && declaration) {
      entries.definitions.push({
        namespace: declaration.namespace,
        keyword: keyword.text,
        name: declaration.name.text,
        line,
        endLine: block.endLine,
        start: declaration.name.start,
        end: declaration.name.end,
      });
    }

    // A SCREAMING_SNAKE value may turn out to be a macro once every file has
    // been read, so its use is kept either way
    if (!block) {
      for (const value of values) {
        if (CONSTANT_NAME.test(value.text)) {
          entries.constantUses.push({
            key: value.text.toLowerCase(),
            line,
            start: value.start,
            end: value.end,
            field: keyword.text,
          });
        }
      }
    }

    // A reference field's values name definitions elsewhere. A polymorphic
    // field is recorded under each namespace it could mean, since which one
    // holds the name is not known until it is looked up.
    for (const reference of findReferencedNames(statement, schema)) {
      for (const namespace of reference.namespaces) {
        entries.references.push({
          namespace,
          name: reference.name,
          line,
          start: reference.start,
          end: reference.end,
          field: keyword.text,
        });
      }
    }
  }

  // Models and animations by file name, so a W3D file finds its users
  for (const asset of findAssetReferences(parsed)) {
    if (asset.kind === 'model' || asset.kind === 'animation') {
      for (const candidate of asset.candidates) {
        entries.references.push({
          namespace: FILE_USES,
          name: candidate,
          line: asset.line,
          start: asset.start,
          end: asset.end,
          field: asset.kind,
        });
      }
    }
  }

  return entries;
};

/**
 * Filters `holders` to the places inside macro bodies that a use of a name reaches. A reference
 * field that is written as a macro names whatever the macro's body spells,
 * through any macros the body is made of, so a rename or a find-references
 * of the name has to follow it in.
 *
 * `holders` are the body tokens that spell the name; `bodyTokens` are all of
 * them by token text, to climb from a macro to the macros that contain it;
 * `isWritten` says whether a macro is written as a value of a field that
 * names the namespace being asked about.
 */
export const reachedThroughMacros = <T extends { macro: string }>(
  holders: readonly T[],
  bodyTokens: ReadonlyMap<string, readonly T[]>,
  isWritten: (macro: string) => boolean,
): T[] => {
  const reaches = (macro: string, seen: Set<string>): boolean => {
    if (seen.has(macro)) {
      return false; // a cycle of macros reaches nothing new
    }

    seen.add(macro);

    return (
      isWritten(macro) ||
      (bodyTokens.get(macro) ?? []).some((holder) =>
        reaches(holder.macro, seen),
      )
    );
  };

  return holders.filter((holder) => reaches(holder.macro, new Set()));
};
