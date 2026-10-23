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

/** One record of a string table */
export interface SageString {
  /** As written, which hovers show */
  label: string;
  /** The text with escapes and spacing applied, as the game shows it */
  text: string;
  /** Line the label sits on */
  line: number;
}

/** Characters `translateCopy` turns an escape into; any other escaped character stands for itself */
const ESCAPES: Record<string, string> = { n: '\n', t: '\t' };

/**
 * Applies the engine's escapes and `stripSpaces`: runs of spaces become one,
 * a space before a newline or tab and the leading and trailing ones go
 */
const finishText = (raw: string): string =>
  raw
    .replace(/\\(.)/g, (_, escaped: string) => ESCAPES[escaped] ?? escaped)
    .replace(/ {2,}/g, ' ')
    .replace(/ +(?=[\n\t])/g, '')
    .trim();

/**
 * Parses a `.str` file into its records, keyed by lowercased label because
 * the engine looks labels up without casing. The first record of a label
 * wins, as mint resolves the duplicates the engine leaves unspecified.
 */
export const parseStringTable = (source: string): Map<string, SageString> => {
  const strings = new Map<string, SageString>();
  const lines = source.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const label = lines[index].trim();
    const labelLine = index;

    index += 1;

    if (!label || label.startsWith('//')) {
      continue;
    }

    let text: string | undefined;

    while (index < lines.length) {
      const line = lines[index].trim();

      if (line.toUpperCase() === 'END') {
        index += 1;
        break;
      }

      if (text === undefined && line.startsWith('"')) {
        // The string runs to the first unescaped quote, across lines if it
        // has to, and the rest of the closing line is discarded
        let raw = line.slice(1);
        let close = raw.search(/(?<!\\)"/);

        while (close < 0 && index + 1 < lines.length) {
          index += 1;
          raw += ` ${lines[index].trim()}`;
          close = raw.search(/(?<!\\)"/);
        }

        text = finishText(
          (close < 0 ? raw : raw.slice(0, close)).replace(/\s+/g, ' '),
        );
      }

      index += 1;
    }

    const key = label.toLowerCase();

    if (text !== undefined && !strings.has(key)) {
      strings.set(key, { label, text, line: labelLine });
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
