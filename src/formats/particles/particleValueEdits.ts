import { parseIniNumber } from './particleDefinitions';
import type { IniDefinition } from './particleDefinitions';

/** A number a slider can move: one value token of one field line */
export interface NumericField {
  /** `line:token`, stable while the text keeps its shape */
  id: string;
  line: number;
  token: number;
  module: string;
  /** Which of the definition's modules it sits in, -1 for none */
  moduleIndex: number;
  keyword: string;
  /** What the token is, like `max`, `G` or `frame` */
  part: string;
  value: number;
  /** Whether the value is a whole number by its meaning */
  integer: boolean;
}

const partNames = (keyword: string, count: number): string[] => {
  const key = keyword.toLowerCase();

  if (/^color[1-8]$/.test(key)) {
    return ['R', 'G', 'B', 'frame'];
  }
  if (/^alpha[1-8]$/.test(key)) {
    return ['min', 'max', 'frame'];
  }
  if (count === 3) {
    return ['X', 'Y', 'Z'];
  }
  if (count === 2) {
    return ['min', 'max'];
  }
  return Array.from({ length: count }, (_, index) =>
    count > 1 ? `${index + 1}` : '',
  );
};

/** Lists every numeric value of a definition, in order, for sliders */
export const findNumericFields = (definition: IniDefinition): NumericField[] =>
  definition.lines.flatMap((line) => {
    const parts = partNames(line.keyword.text, line.values.length);

    return line.values.flatMap((value, token) => {
      const number = parseIniNumber(value.text);

      if (isNaN(number)) {
        return [];
      }

      const part = parts[token] ?? `${token + 1}`;

      return [
        {
          id: `${line.line}:${token}`,
          line: line.line,
          token,
          module: line.module
            ? line.module === line.moduleType
              ? line.module
              : `${line.module} = ${line.moduleType}`
            : '',
          moduleIndex: line.moduleIndex,
          keyword: line.keyword.text,
          part,
          value: number,
          integer:
            part === 'frame' ||
            /^(color[1-8]|burstcount|burstdelay|lifetime|systemlifetime|initialdelay|totalframes|framesperrow|sortlevel)$/i.test(
              line.keyword.text,
            ),
        },
      ];
    });
  });

/** Formats a number the way the INI writes one */
export const formatIniNumber = (value: number, integer: boolean): string => {
  if (integer || Number.isInteger(value)) {
    return String(Math.round(value));
  }
  return String(Number(value.toFixed(4)));
};

/** One changed value: where it sits and what replaces it */
export interface ValueEdit {
  line: number;
  start: number;
  end: number;
  text: string;
}

/**
 * Computes the text edits that write `values` (by field id) over a definition's
 * tokens, keeping each token's `X:` style prefix
 */
export const computeValueEdits = (
  definition: IniDefinition,
  values: ReadonlyMap<string, number>,
): ValueEdit[] =>
  findNumericFields(definition).flatMap((field) => {
    const value = values.get(field.id);

    if (value === undefined || value === field.value) {
      return [];
    }

    const token = definition.lines.find((line) => line.line === field.line)!
      .values[field.token];
    const prefix = /^[A-Za-z]:/.exec(token.text)?.[0] ?? '';

    return [
      {
        line: field.line,
        start: token.start,
        end: token.end,
        text: prefix + formatIniNumber(value, field.integer),
      },
    ];
  });

/** Applies value edits to `text`, for previewing unsaved slider values */
export const applyValueEdits = (text: string, edits: ValueEdit[]): string => {
  const lines = text.split(/\r?\n/);
  const newline = /\r\n/.test(text) ? '\r\n' : '\n';

  [...edits]
    .sort((a, b) => b.line - a.line || b.start - a.start)
    .forEach((edit) => {
      const line = lines[edit.line];

      lines[edit.line] =
        line.slice(0, edit.start) + edit.text + line.slice(edit.end);
    });
  return lines.join(newline);
};
