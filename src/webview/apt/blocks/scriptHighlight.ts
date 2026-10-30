/**
 * Colours script text for the block editor. This is a lexer for display
 * only: it never throws, so text that does not compile still shows, and the
 * compiler's own parser stays the authority on what is valid.
 */

/** Category of a script token, which picks its colour */
export type ScriptTokenKind =
  | 'comment'
  | 'string'
  | 'name-quoted'
  | 'number'
  | 'keyword'
  | 'register'
  | 'directive'
  | 'label'
  | 'operator'
  | 'plain';

/** A token of script text, by its offsets into the text */
export interface ScriptToken {
  kind: ScriptTokenKind;
  start: number;
  end: number;
}

const WORDS = new Set([
  'function',
  'var',
  'new',
  'if',
  'else',
  'while',
  'goto',
  'unless',
  'return',
  'void',
  'asm',
  'push',
  'pop',
  'eval',
  'call',
  'constants',
  'flags',
  'instanceof',
  'true',
  'false',
  'null',
  'undefined',
  'this',
  '_global',
]);

const PATTERNS: [RegExp, ScriptTokenKind][] = [
  [/\/\/[^\n]*/y, 'comment'],
  [/\/\*[\s\S]*?(\*\/|$)/y, 'comment'],
  [/"(\\.|[^"\\\n])*("|$)/y, 'string'],
  [/`(\\.|[^`\\\n])*(`|$)/y, 'name-quoted'],
  [/0x[0-9a-fA-F]+|\d+(\.\d*)?([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?/y, 'number'],
  [/\$r\d+/y, 'register'],
  [/#[A-Za-z_]\w*/y, 'directive'],
  [/[A-Za-z_$][\w$]*/y, 'plain'],
  [/>>>|===|:=|==|>>|<<|[=<>!+\-*/%&|^]+/y, 'operator'],
];

/** Splits `source` into tokens in order; text between them is whitespace or punctuation */
export const tokenizeScript = (source: string): ScriptToken[] => {
  const tokens: ScriptToken[] = [];
  let at = 0;

  while (at < source.length) {
    let matched = false;

    for (const [pattern, kind] of PATTERNS) {
      pattern.lastIndex = at;

      const found = pattern.exec(source);

      if (!found || found[0] === '') {
        continue;
      }

      const end = at + found[0].length;
      let resolved = kind;

      if (kind === 'plain') {
        const rest = source.slice(end).match(/^[ \t]*:(?!=)/);
        const before = source.slice(0, at).match(/(^|[;{}\n])[ \t]*$/);

        resolved = WORDS.has(found[0])
          ? 'keyword'
          : rest && before
            ? 'label'
            : 'plain';
      }
      if (resolved !== 'plain') {
        tokens.push({ kind: resolved, start: at, end });
      }
      at = end;
      matched = true;
      break;
    }
    if (!matched) {
      at++;
    }
  }
  return tokens;
};

/** Gets the line and column, from 1, of an offset of `text` */
export const positionOf = (
  text: string,
  offset: number,
): { line: number; column: number } => {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;

  return { line, column: offset - (before.lastIndexOf('\n') + 1) + 1 };
};

/** Gets the offset of a line and column, from 1, clamped to the text */
export const offsetOf = (
  text: string,
  line: number,
  column: number,
): number => {
  let offset = 0;

  for (let each = 1; each < line; each++) {
    const next = text.indexOf('\n', offset);

    if (next < 0) {
      return text.length;
    }
    offset = next + 1;
  }
  return Math.min(text.length, offset + Math.max(0, column - 1));
};

/**
 * Finds the span an error at a line and column underlines: the token starting
 * there, or the rest of the line when none does
 */
export const errorSpan = (
  text: string,
  line: number,
  column: number,
): { start: number; end: number } => {
  const start = offsetOf(text, line, column);
  const token = tokenizeScript(text).find(
    (each) => each.start <= start && start < each.end,
  );

  if (token) {
    return { start: token.start, end: token.end };
  }

  const word = /^[\w$]+|^[^\s\w]/.exec(text.slice(start));
  const lineEnd = text.indexOf('\n', start);

  return {
    start,
    end: word
      ? start + word[0].length
      : lineEnd < 0
        ? text.length
        : Math.max(start + 1, lineEnd),
  };
};

/** A run of text drawn in one colour, underlined when it is where an error is */
export interface ScriptSegment {
  text: string;
  kind: ScriptTokenKind;
  error: boolean;
}

/** Cuts the text at token and error boundaries into segments covering all of it */
export const segmentScript = (
  text: string,
  error?: { start: number; end: number },
): ScriptSegment[] => {
  const cuts = new Set([0, text.length]);
  const tokens = tokenizeScript(text);

  for (const token of tokens) {
    cuts.add(token.start);
    cuts.add(token.end);
  }
  if (error) {
    cuts.add(Math.min(text.length, error.start));
    cuts.add(Math.min(text.length, error.end));
  }

  const points = [...cuts].sort((a, b) => a - b);
  const segments: ScriptSegment[] = [];

  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    const token = tokens.find(
      (each) => each.start <= start && start < each.end,
    );

    segments.push({
      text: text.slice(start, end),
      kind: token?.kind ?? 'plain',
      error: !!error && start >= error.start && end <= error.end,
    });
  }
  return segments;
};
