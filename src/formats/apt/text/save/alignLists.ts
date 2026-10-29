import { f32Bits } from '../numbers';
import type { ItemText } from '../textModel';
import { TextSaveError } from './textSaveError';

/** Pairs two lists: alike entries first, then entries of the same kind in order */
export const alignLists = <T>(
  before: T[],
  after: T[],
  key: (entry: T) => string,
  kind: (entry: T) => string = () => '',
): [number | undefined, number | undefined][] => {
  const a = before.map(key);
  const b = after.map(key);
  // Entries alike from the start pair as they stand, so the table below only
  // spans what follows them: a list that did not change costs a single pass
  let head = 0;

  while (head < a.length && head < b.length && a[head] === b[head]) {
    head++;
  }

  const columns = b.length - head + 1;
  const lengths = new Uint32Array((a.length - head + 1) * columns);
  const at = (i: number, j: number) => (i - head) * columns + (j - head);

  for (let i = a.length - 1; i >= head; i--) {
    for (let j = b.length - 1; j >= head; j--) {
      lengths[at(i, j)] =
        a[i] === b[j]
          ? lengths[at(i + 1, j + 1)] + 1
          : Math.max(lengths[at(i + 1, j)], lengths[at(i, j + 1)]);
    }
  }

  const pairs: [number | undefined, number | undefined][] = [];
  let gapA: number[] = [];
  let gapB: number[] = [];
  const flush = () => {
    const used = new Set<number>();

    for (const j of gapB) {
      const i = gapA.find(
        (each) => !used.has(each) && kind(before[each]) === kind(after[j]),
      );

      if (i === undefined) {
        pairs.push([undefined, j]);
      } else {
        used.add(i);
        pairs.push([i, j]);
      }
    }
    gapA
      .filter((each) => !used.has(each))
      .forEach((i) => pairs.push([i, undefined]));
    gapA = [];
    gapB = [];
  };
  let i = 0;
  let j = 0;

  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      pairs.push([i++, j++]);
    } else if (
      j >= b.length ||
      (i < a.length && lengths[at(i + 1, j)] >= lengths[at(i, j + 1)])
    ) {
      gapA.push(i++);
    } else {
      gapB.push(j++);
    }
  }
  flush();
  return pairs;
};

/** Refuses an addition in the middle of a list that only grows at its end */
export const checkAppended = (
  pairs: [number | undefined, number | undefined][],
  after: { line?: number }[],
  what: string,
): void => {
  let added: number | undefined;

  for (const [i, j] of pairs) {
    if (j === undefined) {
      continue;
    }
    if (i === undefined) {
      added ??= j;
    } else if (added !== undefined) {
      throw new TextSaveError(
        `A new ${what} goes after the existing ones`,
        after[added].line,
      );
    }
  }
};

/** The key two frame items, runs or button records are aligned by: every field but where it sits */
export const printItem = (item: ItemText): string =>
  JSON.stringify(item, (key, value) =>
    key === 'offset' || key === 'line' || key === 'endLine' || key === 'block'
      ? undefined
      : typeof value === 'number' &&
          (!Number.isInteger(value) || Object.is(value, -0))
        ? f32Bits(value)
        : value,
  );
