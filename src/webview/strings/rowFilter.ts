import type { StringRow } from './protocol';

/** Number of rows the table adds per page, each "Show more" showing the next */
export const ROWS_PER_PAGE = 200;

/** Whether a row's label, text or speech holds the lower-cased filter text; an empty filter keeps every row. */
export const matchesFilter = (row: StringRow, text: string): boolean =>
  !text ||
  row.label.toLowerCase().includes(text) ||
  row.text.toLowerCase().includes(text) ||
  (row.speech ?? '').toLowerCase().includes(text);

/** Filters rows to those `matchesFilter` keeps, comparing case-insensitively */
export const filterRows = (
  rows: readonly StringRow[],
  filter: string,
): StringRow[] => {
  const text = filter.toLowerCase();

  return rows.filter((row) => matchesFilter(row, text));
};

/** Formats the label count: all labels, or how many of them the filter keeps */
export const describeCount = (visible: number, total: number): string =>
  visible === total ? `${total} labels` : `${visible} of ${total} labels`;
