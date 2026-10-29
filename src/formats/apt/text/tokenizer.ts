/** One word of a line: a bare word, a quoted string, or a `key=value` pair */
export interface Token {
  /** The word, or the string's contents */
  text: string;
  /** For `key=value`, the key; `text` is then the value */
  key?: string;
  isString: boolean;
  column: number;
  endColumn: number;
}

/** A line that does not read, with the columns the problem spans */
export class ParseError extends Error {
  public constructor(
    message: string,
    public readonly column = 0,
    public readonly endColumn = 0,
  ) {
    super(message);
  }
}

/** Reads a quoted string starting at `start`; returns it and the column after it */
const readString = (line: string, start: number): [string, number] => {
  let text = '';
  let at = start + 1;

  while (at < line.length && line[at] !== '"') {
    const char = line[at];

    if (char !== '\\') {
      if (char.charCodeAt(0) > 0xff) {
        throw new ParseError(
          `"${char}" is not Latin-1; a movie string holds Latin-1 only`,
          at,
          at + 1,
        );
      }
      text += char;
      at++;
      continue;
    }

    const escape = line[at + 1];

    if (escape === 'x' && /^[0-9a-fA-F]{2}$/.test(line.slice(at + 2, at + 4))) {
      text += String.fromCharCode(parseInt(line.slice(at + 2, at + 4), 16));
      at += 4;
    } else if (escape !== undefined && '"\\ntr'.includes(escape)) {
      text +=
        { n: '\n', t: '\t', r: '\r' }[escape as 'n' | 't' | 'r'] ?? escape;
      at += 2;
    } else {
      throw new ParseError('Unknown escape in a string', at, at + 2);
    }
  }

  if (line[at] !== '"') {
    throw new ParseError('A string is not closed', start, line.length);
  }
  if (text.includes('\0')) {
    throw new ParseError('A movie string cannot hold NUL', start, at + 1);
  }
  return [text, at + 1];
};

/** Splits a line into words, strings and `key=value` pairs; `;` starts a comment */
export const tokenize = (line: string): Token[] => {
  const tokens: Token[] = [];
  let at = 0;

  while (at < line.length) {
    if (/\s/.test(line[at])) {
      at++;
      continue;
    }
    if (line[at] === ';') {
      break;
    }

    const start = at;

    if (line[at] === '"') {
      const [text, end] = readString(line, at);

      tokens.push({ text, isString: true, column: start, endColumn: end });
      at = end;
      continue;
    }

    while (at < line.length && !/[\s="]/.test(line[at])) {
      at++;
    }

    if (line[at] === '=') {
      const key = line.slice(start, at);

      at++;
      if (line[at] === '"') {
        const [text, end] = readString(line, at);

        tokens.push({
          key,
          text,
          isString: true,
          column: start,
          endColumn: end,
        });
        at = end;
        continue;
      }

      const valueStart = at;

      while (at < line.length && !/[\s"]/.test(line[at])) {
        at++;
      }
      tokens.push({
        key,
        text: line.slice(valueStart, at),
        isString: false,
        column: start,
        endColumn: at,
      });
      continue;
    }

    if (line[at] === '"') {
      throw new ParseError('A string must stand apart or follow =', at, at + 1);
    }
    tokens.push({
      text: line.slice(start, at),
      isString: false,
      column: start,
      endColumn: at,
    });
  }
  return tokens;
};

/** Reads a whole number, decimal or 0x hex, in a range */
export const integer = (
  token: Token,
  min: number,
  max: number,
  what: string,
): number => {
  const text = token.text;
  const value = /^-?0x[0-9a-f]+$/i.test(text)
    ? (text.startsWith('-') ? -1 : 1) * parseInt(text.replace(/^-?0x/i, ''), 16)
    : /^-?\d+$/.test(text)
      ? Number(text)
      : NaN;

  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ParseError(
      `${what} must be a whole number from ${min} to ${max}, not "${text}"`,
      token.column,
      token.endColumn,
    );
  }
  return value;
};

/** Reads an unsigned 32-bit whole number */
export const u32 = (token: Token, what: string) =>
  integer(token, 0, 0xffffffff, what);
/** Reads a signed 32-bit whole number */
export const i32 = (token: Token, what: string) =>
  integer(token, -0x80000000, 0x7fffffff, what);

/** Reads one number as a 32-bit float; `nan`, `inf` and `-inf` name the special values */
export const floatOf = (text: string, token: Token, what: string): number => {
  const value =
    text === 'nan'
      ? NaN
      : text === 'inf'
        ? Infinity
        : text === '-inf'
          ? -Infinity
          : /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)
            ? Number(text)
            : undefined;

  if (value === undefined) {
    throw new ParseError(
      `${what} must be a number, not "${text}"`,
      token.column,
      token.endColumn,
    );
  }
  return Math.fround(value);
};

/** Reads a fixed count of comma-separated floats from one token */
export const floats = (token: Token, count: number, what: string): number[] => {
  const parts = token.text.split(',');

  if (parts.length !== count) {
    throw new ParseError(
      `${what} takes ${count} numbers separated by commas`,
      token.column,
      token.endColumn,
    );
  }
  return parts.map((part) => floatOf(part, token, what));
};

/** The words of a line after its keyword, by key, with the bare words in order */
export class Fields {
  private readonly keyed = new Map<string, Token>();
  private readonly used = new Set<string>();
  public readonly bare: Token[] = [];

  public constructor(
    tokens: Token[],
    private readonly what: string,
  ) {
    for (const token of tokens) {
      if (token.key === undefined) {
        this.bare.push(token);
      } else if (this.keyed.has(token.key)) {
        throw new ParseError(
          `${token.key}= is given twice`,
          token.column,
          token.endColumn,
        );
      } else {
        this.keyed.set(token.key, token);
      }
    }
  }

  public optional(key: string): Token | undefined {
    this.used.add(key);
    return this.keyed.get(key);
  }

  public required(key: string, line: Token[]): Token {
    const token = this.optional(key);

    if (!token) {
      const last = line[line.length - 1];

      throw new ParseError(
        `${this.what} needs ${key}=`,
        line[0]?.column ?? 0,
        last?.endColumn ?? 0,
      );
    }
    return token;
  }

  public string(key: string): string | undefined {
    const token = this.optional(key);

    if (token && !token.isString) {
      throw new ParseError(
        `${key}= takes a quoted string`,
        token.column,
        token.endColumn,
      );
    }
    return token?.text;
  }

  /** Fails on a key the line does not take */
  public finish(): void {
    for (const [key, token] of this.keyed) {
      if (!this.used.has(key)) {
        throw new ParseError(
          `${this.what} has no field ${key}`,
          token.column,
          token.endColumn,
        );
      }
    }
  }
}
