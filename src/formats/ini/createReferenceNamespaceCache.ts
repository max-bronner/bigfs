/** Resolves the namespaces a field's value names, as `SageIniSchema.getReferenceNamespaces` does */
type ResolveNamespaces = (
  field: string,
  context?: string,
  tokenIndex?: number,
) => readonly string[];

/** How many answers are kept before the cache starts over */
const CACHE_LIMIT = 20_000;

/**
 * Wraps a namespace lookup so a field asked about again in the same block is
 * answered from tables keyed by the strings the caller already holds. Indexing
 * a game's INI files asks the same few hundred questions millions of times,
 * and the lookup builds new strings to answer each one. Emptied at
 * `CACHE_LIMIT` answers, since fields come from the text being read.
 */
export const createReferenceNamespaceCache = (
  resolve: ResolveNamespaces,
): ResolveNamespaces => {
  let byContext = new Map<
    string | undefined,
    Map<string, Map<number | undefined, readonly string[]>>
  >();
  let size = 0;

  return (field, context, tokenIndex) => {
    const byField = byContext.get(context) ?? new Map();
    const byToken = byField.get(field) ?? new Map();
    const known = byToken.get(tokenIndex);

    if (known) {
      return known;
    }

    if (size >= CACHE_LIMIT) {
      byContext = new Map();
      size = 0;

      return resolve(field, context, tokenIndex);
    }

    const answer = resolve(field, context, tokenIndex);

    byToken.set(tokenIndex, answer);
    byField.set(field, byToken);
    byContext.set(context, byField);
    size += 1;

    return answer;
  };
};
