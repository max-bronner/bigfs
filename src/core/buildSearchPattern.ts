/** What the search box holds: the text and the three toggles beside it */
export interface SearchQuery {
  text: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** A regular expression ready to run, or the reason the query cannot be one */
export type SearchPattern =
  | { source: string; flags: string }
  | { error: string };

/** Whether a character is one a word is made of */
const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && /\w/.test(character);

/**
 * Turns a query into the source and flags of a regular expression, as VS
 * Code's search does: literal text is escaped, whole word adds boundaries
 * only where the text starts or ends in a word character, and a regular
 * expression that does not compile comes back as an error with its message.
 */
export const buildSearchPattern = (query: SearchQuery): SearchPattern => {
  if (!query.text) {
    return { error: 'Type something to search for.' };
  }

  const body = query.regex
    ? query.text
    : query.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const before =
    query.wholeWord && (query.regex || isWordCharacter(query.text[0]))
      ? '\\b'
      : '';
  const after =
    query.wholeWord && (query.regex || isWordCharacter(query.text.at(-1)))
      ? '\\b'
      : '';
  const source = query.wholeWord ? `${before}(?:${body})${after}` : body;
  const flags = query.caseSensitive ? 'gm' : 'gim';

  try {
    new RegExp(source, flags);
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : 'Invalid regular expression',
    };
  }

  return { source, flags };
};
