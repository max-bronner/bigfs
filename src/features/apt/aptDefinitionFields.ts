import type { Uri } from 'vscode';
import type { SageDefinition, SageIniIndex } from '../../services/ini/sageIniIndex';

/** The part of the INI index the lookups read */
export type SuggestionIndex = Pick<SageIniIndex, 'getNames' | 'findDefinitions'>;

/** Reads a file's text, as the editor shows it */
export type ReadText = (uri: Uri) => Promise<string>;

/** A definition with the `name = value` fields its block writes */
export interface DefinitionFields {
  definition: Pick<SageDefinition, 'uri' | 'line' | 'name' | 'keyword'>;
  /** The first value of each field name, lowercased; a comment ends a value */
  fields: Map<string, string>;
}

/** Reads `name = value` lines into a map, keeping the first of each name; a `;` or `//` comment ends a value */
export const readFields = (lines: readonly string[]): Map<string, string> => {
  const fields = new Map<string, string>();

  for (const line of lines) {
    const match = /^\s*(\w+)\s*=\s*(.*?)\s*(?:;|\/\/|$)/.exec(line);

    if (match && !fields.has(match[1].toLowerCase())) {
      fields.set(match[1].toLowerCase(), match[2].trim());
    }
  }
  return fields;
};

/**
 * Reads the fields of every definition of a namespace, one file read per file.
 * A file that cannot be read leaves its definitions out.
 */
export const readDefinitionFields = async (
  index: SuggestionIndex,
  namespace: string,
  read: ReadText,
): Promise<DefinitionFields[]> => {
  const definitions = index
    .getNames(namespace)
    .flatMap((name) => index.findDefinitions(namespace, name).slice(0, 1));
  const texts = new Map<string, Promise<string[] | undefined>>();
  const lines = (uri: Uri) => {
    const key = uri.toString();

    if (!texts.has(key)) {
      texts.set(
        key,
        read(uri).then(
          (text) => text.split(/\r?\n/),
          () => undefined,
        ),
      );
    }
    return texts.get(key)!;
  };
  const found: DefinitionFields[] = [];

  for (const definition of definitions) {
    const body = (await lines(definition.uri))?.slice(
      definition.line + 1,
      definition.endLine,
    );

    if (body) {
      found.push({ definition, fields: readFields(body) });
    }
  }
  return found;
};
