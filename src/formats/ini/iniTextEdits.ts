/**
 * Changes to the text of one INI or string table entry, applied to the text
 * itself. A file on disk is edited through the editor; an entry inside an
 * archive has no editor, so its new text is built here and the archive is
 * saved once with it.
 */

/** Replacement of the columns `start` to `end` of one line, both zero-based */
export interface LineReplacement {
  line: number;
  start: number;
  end: number;
  /** Text that takes the place of the replaced columns */
  after: string;
}

/** Text inserted before a line, or at the end of the file when `line` is missing */
export interface LineInsertion {
  line?: number;
  /** Lines to add, without line ends */
  lines: string[];
}

/** Detects the line end a text uses, so an edit does not mix endings into it */
export const detectLineEnd = (text: string): string =>
  text.includes('\r\n') ? '\r\n' : '\n';

/** Applies replacements to a text, keeping every line end as it was */
export const replaceInLines = (
  text: string,
  replacements: readonly LineReplacement[],
): string => {
  // Odd entries are the separators, which are kept verbatim
  const parts = text.split(/(\r\n|\n)/);

  for (const replacement of [...replacements].sort(
    (a, b) => b.line - a.line || b.start - a.start,
  )) {
    const at = replacement.line * 2;
    const line = parts[at];

    if (line !== undefined) {
      parts[at] =
        line.slice(0, replacement.start) +
        replacement.after +
        line.slice(replacement.end);
    }
  }
  return parts.join('');
};

/**
 * Applies insertions to a text: each before its line, those with no line
 * after the last one, separated from it by a blank line
 */
export const insertLines = (
  text: string,
  insertions: readonly LineInsertion[],
): string => {
  const eol = detectLineEnd(text);
  const lines = text.split(/\r?\n/);

  for (const insertion of [...insertions]
    .filter((each) => each.line !== undefined)
    .sort((a, b) => b.line! - a.line!)) {
    lines.splice(
      Math.min(insertion.line!, lines.length),
      0,
      ...insertion.lines,
    );
  }

  const appended = insertions
    .filter((each) => each.line === undefined)
    .map((each) => each.lines.join(eol));

  if (!appended.length) {
    return lines.join(eol);
  }
  while (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return (
    lines.join(eol) +
    (lines.length ? eol + eol : '') +
    appended.join(eol + eol) +
    eol
  );
};
