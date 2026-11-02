import { matchFuzzy } from './matchFuzzy';

/** Added to a file name match so it outranks a match that is only found in the folders */
const NAME_MATCH_BONUS = 1000;

/**
 * Scores how well a query finds a file, as quick open does: the file name
 * first, so `obj` finds `object.ini` before `data/objects/readme.txt`, and
 * the whole path when the name alone does not hold the query or the query
 * itself names folders. Nothing when the path does not hold the query.
 */
export const scoreFilePath = (
  query: string,
  name: string,
  filePath: string,
): number | undefined => {
  const wanted = query.replace(/\s+/g, '').replace(/\\/g, '/');

  if (!wanted) {
    return 0;
  }

  if (!wanted.includes('/')) {
    const byName = matchFuzzy(wanted, name);

    if (byName) {
      return NAME_MATCH_BONUS + byName.score;
    }
  }

  return matchFuzzy(wanted, filePath.replace(/\\/g, '/'))?.score;
};
