import type { StringRow } from './protocol';

/** How many rows the table shows before "Show more" */
export const ROWS_PER_PAGE = 200;

/** Whether a row's label, text or speech holds the lower-cased filter text; an empty filter keeps every row. */
export const matchesFilter = (row: StringRow, text: string): boolean =>
  !text ||
  row.label.toLowerCase().includes(text) ||
  row.text.toLowerCase().includes(text) ||
  (row.speech ?? '').toLowerCase().includes(text);

/** The rows the filter keeps, case-insensitively. */
export const filterRows = (
  rows: readonly StringRow[],
  filter: string,
): StringRow[] => {
  const text = filter.toLowerCase();

  return rows.filter((row) => matchesFilter(row, text));
};

/** The text of the label count: all labels, or how many of them the filter keeps. */
export const describeCount = (visible: number, total: number): string =>
  visible === total ? `${total} labels` : `${visible} of ${total} labels`;
