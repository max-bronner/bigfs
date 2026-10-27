/**
 * The records of a `.str` file with where each part sits in the text, for
 * the table editor and the diagnostics. Reading follows the engine's rules
 * as `sageStringTable.ts` describes them; this module only adds positions.
 */

/** A span of the source, as character offsets */
export interface Span {
  start: number;
  end: number;
}

export interface StringRecord {
  label: string;
  /** The text as the game shows it, or nothing when the record has none */
  text?: string;
  /** The label line, without its line break */
  labelSpan: Span;
  /** The quoted text, from its opening quote past its closing one */
  textSpan?: Span;
  /** From the label to the end of the `END` line, line break included */
  span: Span;
  /** Line of the label, from 0 */
  line: number;
  hasEnd: boolean;
  /** The text's closing quote is missing */
  isUnclosed: boolean;
}

/** Characters `translateCopy` turns an escape into; any other escaped character stands for itself */
const ESCAPES: Record<string, string> = { n: '\n', t: '\t' };

/**
 * Applies the engine's escapes and `stripSpaces`: runs of spaces become one,
 * a space before a newline or tab and the leading and trailing ones go
 */
export const finishText = (raw: string): string =>
  raw
    .replace(/\\(.)/g, (_, escaped: string) => ESCAPES[escaped] ?? escaped)
    .replace(/ {2,}/g, ' ')
    .replace(/ +(?=[\n\t])/g, '')
    .trim();

/** The quoted form of a text, so that reading it gives the text back */
export const quoteStringText = (text: string): string =>
  `"${text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')
    .replace(/\t/g, '\\t')}"`;

/** One `.str` record, as the string reader reads it back */
export const strRecord = (label: string, text: string, eol: string): string =>
  `${label}${eol}${quoteStringText(text)}${eol}END${eol}`;

/**
 * Where the text ends: the first quote no backslash escapes. A backslash
 * escapes the character after it, itself included, so `\\"` closes the text.
 */
const closingQuote = (raw: string): number => {
  for (let at = 0; at < raw.length; at++) {
    if (raw[at] === '\\') {
      at += 1;
    } else if (raw[at] === '"') {
      return at;
    }
  }
  return -1;
};

/** Splits the source into lines with their start offsets */
const splitLines = (source: string) => {
  const lines: { text: string; start: number; end: number; next: number }[] =
    [];
  const pattern = /\r?\n/g;
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source))) {
    lines.push({
      text: source.slice(start, match.index),
      start,
      end: match.index,
      next: match.index + match[0].length,
    });
    start = match.index + match[0].length;
  }

  lines.push({
    text: source.slice(start),
    start,
    end: source.length,
    next: source.length,
  });

  return lines;
};

/** Every record in the order written, duplicates included */
export const parseStringRecords = (source: string): StringRecord[] => {
  const lines = splitLines(source);
  const records: StringRecord[] = [];
  let index = 0;

  while (index < lines.length) {
    const labelLine = lines[index];
    const label = labelLine.text.trim();
    const line = index;

    index += 1;

    if (!label || label.startsWith('//')) {
      continue;
    }

    const leading = labelLine.text.length - labelLine.text.trimStart().length;
    const record: StringRecord = {
      label,
      labelSpan: {
        start: labelLine.start + leading,
        end: labelLine.start + leading + label.length,
      },
      span: { start: labelLine.start, end: source.length },
      line,
      hasEnd: false,
      isUnclosed: false,
    };

    while (index < lines.length) {
      const current = lines[index];
      const trimmed = current.text.trim();

      if (trimmed.toUpperCase() === 'END') {
        record.hasEnd = true;
        record.span.end = current.next;
        index += 1;
        break;
      }

      if (record.text === undefined && trimmed.startsWith('"')) {
        // The string runs to the first unescaped quote, across lines if it
        // has to, and the rest of the closing line is discarded
        const open = current.start + current.text.indexOf('"');
        let raw = trimmed.slice(1);
        let close = closingQuote(raw);
        let closeLine = current;
        let closeOffset = close < 0 ? -1 : open + 1 + close;

        while (close < 0 && index + 1 < lines.length) {
          index += 1;
          closeLine = lines[index];

          const before = raw.length + 1;
          const part = closeLine.text.trim();

          raw += ` ${part}`;
          close = closingQuote(raw);

          if (close >= 0) {
            const lead =
              closeLine.text.length - closeLine.text.trimStart().length;

            closeOffset = closeLine.start + lead + (close - before);
          }
        }

        record.isUnclosed = close < 0;
        record.text = finishText(
          (close < 0 ? raw : raw.slice(0, close)).replace(/\s+/g, ' '),
        );
        record.textSpan = {
          start: open,
          end: close < 0 ? closeLine.end : closeOffset + 1,
        };
      }

      index += 1;
    }

    records.push(record);
  }

  return records;
};
