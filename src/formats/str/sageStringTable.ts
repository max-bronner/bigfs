/**
 * Parser for the game's `.str` string tables, which hold every piece of
 * on-screen text an INI line refers to by label: `DisplayName =
 * OBJECT:GondorFighter` shows the text recorded under `OBJECT:GondorFighter`.
 *
 * The rules are the engine's own (`GameText.cpp` in EA's Generals release, as
 * mint's `docs/research/localisation-format.md` records them):
 *
 * ```
 * // a comment
 * OBJECT:GondorFighter
 * // context: unit name
 * "Gondor Soldiers"
 * END
 * ```
 *
 * Between records a line is blank, a `//` comment, or a label. Inside one,
 * the first quoted string is the text, a quote may run past its line with
 * every whitespace run becoming one space, and every other line is ignored up
 * to `END`. The `.csf` binary form carries no in-game text in either game, so
 * only `.str` is read.
 */

import { parseStringRecords } from './sageStringRecords';

/** One record of a string table */
export interface SageString {
  /** As written, which hovers show */
  label: string;
  /** The text with escapes and spacing applied, as the game shows it */
  text: string;
  /** Line the label sits on */
  line: number;
}

/**
 * Parses a `.str` file into its records, keyed by lowercased label because
 * the engine looks labels up without casing. The first record of a label
 * wins, as mint resolves the duplicates the engine leaves unspecified.
 */
export const parseStringTable = (source: string): Map<string, SageString> => {
  const strings = new Map<string, SageString>();

  for (const record of parseStringRecords(source)) {
    const key = record.label.toLowerCase();

    if (record.text !== undefined && !strings.has(key)) {
      strings.set(key, {
        label: record.label,
        text: record.text,
        line: record.line,
      });
    }
  }

  return strings;
};

/**
 * Finds the record an INI value names. A `$` prefix is an APT key, tried as
 * `APT:<key>` before the key itself.
 */
export const findString = (
  strings: ReadonlyMap<string, SageString>,
  value: string,
): SageString | undefined => {
  const key = value.toLowerCase();

  if (key.startsWith('$')) {
    return strings.get(`apt:${key.slice(1)}`) ?? strings.get(key.slice(1));
  }

  return strings.get(key);
};
