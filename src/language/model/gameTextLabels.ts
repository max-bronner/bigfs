import { stripComment, tokenize } from './sageIniParser';
import type { SageDocument } from './sageIniParser';

/**
 * Game-text labels written in INI values, like `OBJECT:GondorFighter` or
 * `CONTROLBAR:ToolTipBuild`: a category of at least three capitals, a
 * colon, and a name. Coordinates (`X:10`), colours (`R:255`) and weighted
 * sounds (`name:2000`) do not match.
 */

const LABEL = /^[A-Z][A-Z0-9_]{2,}:[A-Za-z_][\w.-]*$/;

export interface LabelToken {
  text: string;
  line: number;
  start: number;
  end: number;
}

export const findGameTextLabels = (parsed: SageDocument): LabelToken[] =>
  parsed.statements.flatMap((statement) =>
    statement.kind === 'field'
      ? statement.values
          .filter((value) => LABEL.test(value.text))
          .map((value) => ({
            text: value.text,
            line: statement.line,
            start: value.start,
            end: value.end,
          }))
      : [],
  );

/**
 * The labels an INI text writes as values, found without a schema: the words
 * after the first on each line, so a tool that only counts them need not
 * parse the file
 */
export const labelsInText = (text: string): string[] =>
  text.split(/\r?\n/).flatMap((line) =>
    tokenize(stripComment(line))
      .slice(1)
      .map((token) => token.text)
      .filter((word) => LABEL.test(word)),
  );

export const missingTextMessage = (label: string): string =>
  `No game text for '${label}' in any string table`;

/** The label a missing-text message names */
export const labelOfMissingText = (message: string): string | undefined =>
  /^No game text for '(.+)' in any string table$/.exec(message)?.[1];

/** A first text for a new label: its name split into words */
export const placeholderText = (label: string): string =>
  label
    .slice(label.indexOf(':') + 1)
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .trim();
