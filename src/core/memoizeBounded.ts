/**
 * Wraps a pure function of one string so a repeated argument is answered from
 * a table. The table is emptied when it reaches `limit` entries, so arguments
 * taken from untrusted text cannot grow it without bound.
 */
export const memoizeBounded = <Result>(
  compute: (key: string) => Result,
  limit: number,
): ((key: string) => Result) => {
  let answers = new Map<string, Result>();

  return (key) => {
    const known = answers.get(key);

    if (known !== undefined) {
      return known;
    }

    if (answers.size >= limit) {
      answers = new Map();
    }

    const computed = compute(key);

    answers.set(key, computed);

    return computed;
  };
};
