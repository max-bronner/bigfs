/**
 * Fuzzy matching of a typed query against a name or path, scored the way a
 * quick open list ranks: a match at the start of the target or of a word
 * beats one in the middle, and characters that follow each other beat
 * scattered ones.
 */

/** Result of a fuzzy match: the score, higher being better, and the target positions that matched */
export interface FuzzyMatch {
  score: number;
  /** Index into the target of each query character, ascending */
  positions: number[];
}

/** Longest target matched; a longer one keeps its tail, where a path's file name is */
const MAX_TARGET = 512;

/** Longest query matched */
const MAX_QUERY = 64;

const WORD_START_BONUS = 10;
const FIRST_CHARACTER_BONUS = 24;
const CAMEL_BONUS = 8;
const CONSECUTIVE_BONUS = 6;
const GAP_PENALTY = 1;
const LEADING_PENALTY_LIMIT = 8;
const PREFIX_BONUS = 24;
const EXACT_BONUS = 40;
const IMPOSSIBLE = -1_000_000;

const SEPARATORS = '/\\._- ';

/** Scratch tables the matcher fills, shared by every call since a call finishes before the next begins */
const scores = new Int32Array(MAX_QUERY * MAX_TARGET);
const sources = new Int16Array(MAX_QUERY * MAX_TARGET);

/** Gets the bonus for matching at each position of a target */
const getBonuses = (target: string): number[] =>
  Array.from(target, (character, index) => {
    if (index === 0) {
      return FIRST_CHARACTER_BONUS;
    }

    const previous = target[index - 1];

    if (SEPARATORS.includes(previous)) {
      return WORD_START_BONUS;
    }

    const isCamelStart =
      character !== character.toLowerCase() &&
      previous === previous.toLowerCase() &&
      previous !== previous.toUpperCase();

    return isCamelStart ? CAMEL_BONUS : 0;
  });

/**
 * Matches the characters of a query in order against a target, without
 * regard to casing, and picks the alignment that scores best. Nothing when
 * the target does not hold the query's characters in that order.
 */
export const matchFuzzy = (
  query: string,
  target: string,
): FuzzyMatch | undefined => {
  if (!query) {
    return { score: 0, positions: [] };
  }

  const clipped =
    target.length > MAX_TARGET ? target.slice(-MAX_TARGET) : target;
  const offset = target.length - clipped.length;
  const wanted = query.toLowerCase();
  const haystack = clipped.toLowerCase();

  if (
    wanted.length > MAX_QUERY ||
    wanted.length !== query.length ||
    haystack.length !== clipped.length
  ) {
    return undefined;
  }

  let cursor = 0;

  for (const character of wanted) {
    cursor = haystack.indexOf(character, cursor) + 1;

    if (cursor === 0) {
      return undefined;
    }
  }

  const width = haystack.length;
  const bonuses = getBonuses(clipped);

  for (let row = 0; row < wanted.length; row += 1) {
    const base = row * width;
    const above = base - width;
    // Best score of an earlier row ending two or more positions before this one, less the gap
    let gap = IMPOSSIBLE;
    let gapSource = -1;

    for (let column = 0; column < width; column += 1) {
      scores[base + column] = IMPOSSIBLE;

      if (wanted[row] === haystack[column]) {
        if (row === 0) {
          scores[base + column] =
            1 + bonuses[column] - Math.min(column, LEADING_PENALTY_LIMIT);
        } else {
          const adjacent = column > 0 ? scores[above + column - 1] : IMPOSSIBLE;
          let best = IMPOSSIBLE;
          let from = -1;

          if (adjacent > IMPOSSIBLE) {
            best = adjacent + CONSECUTIVE_BONUS;
            from = column - 1;
          }

          if (gap > best) {
            best = gap;
            from = gapSource;
          }

          if (best > IMPOSSIBLE) {
            scores[base + column] = best + 1 + bonuses[column];
            sources[base + column] = from;
          }
        }
      }

      if (row > 0) {
        const adjacent = column > 0 ? scores[above + column - 1] : IMPOSSIBLE;

        gap = gap > IMPOSSIBLE ? gap - GAP_PENALTY : IMPOSSIBLE;

        if (adjacent > IMPOSSIBLE && adjacent - GAP_PENALTY > gap) {
          gap = adjacent - GAP_PENALTY;
          gapSource = column - 1;
        }
      }
    }
  }

  const last = (wanted.length - 1) * width;
  let end = -1;

  for (let column = 0; column < width; column += 1) {
    if (
      scores[last + column] > IMPOSSIBLE &&
      (end < 0 || scores[last + column] > scores[last + end])
    ) {
      end = column;
    }
  }

  if (end < 0) {
    return undefined;
  }

  const positions: number[] = [];
  let column = end;

  for (let row = wanted.length - 1; row >= 0; row -= 1) {
    positions.unshift(column + offset);
    column = sources[row * width + column];
  }

  let score = scores[last + end];

  if (haystack.startsWith(wanted)) {
    score += haystack.length === wanted.length ? EXACT_BONUS : PREFIX_BONUS;
  }

  return { score, positions };
};
