import { compileExpression } from '../../common/expression';
import { forEachBlock } from './sageIniParser';
import type { SageBlock, SageDocument, SageStatement } from './sageIniParser';

/**
 * Changing many INI values at once by a formula: "every Object whose name
 * has Rohan in it, with Side = Rohan and KindOf INFANTRY: ActiveBody's
 * MaxHealth becomes round(x * 1.1)". The selection is read on the parsed
 * blocks, so it follows the grammar (a field in a module, not a line that
 * happens to start with the word); the result is a list of token edits to
 * preview and apply.
 *
 * - blocks: a top-level keyword and an optional name pattern (`*` and `?`)
 * - where: conditions on the block's fields, `;`-separated: `Side = Rohan`,
 *   `KindOf ~ INFANTRY` (any value is), `!=`, `!~`, and `<`, `<=`, `>`, `>=`
 *   on numbers
 * - field: `MaxHealth`, or `ActiveBody/MaxHealth` to name the module (its
 *   keyword, type or tag), with `[2]` for the second value only
 * - formula: in terms of `x`, the value now, and the block's own numeric
 *   fields by name
 */

export interface BulkQuery {
  blocks: string;
  where: string;
  field: string;
  formula: string;
}

export interface BulkChange {
  line: number;
  start: number;
  end: number;
  before: string;
  after: string;
  /** The top-level block it belongs to, for the preview */
  block: string;
}

export interface BulkResult {
  changes: BulkChange[];
  /** Blocks that matched the selection and the conditions */
  blocks: number;
  /** Matching values that are not numbers (a macro, a name) and were left */
  skipped: number;
}

interface FieldSelector {
  module?: string;
  field: string;
  /** Zero-based value index, or every value */
  token?: number;
}

interface Condition {
  selector: FieldSelector;
  op: '=' | '!=' | '~' | '!~' | '<' | '<=' | '>' | '>=';
  value: string;
}

export interface CompiledQuery {
  keyword: string;
  name?: RegExp;
  conditions: Condition[];
  field: FieldSelector;
  formula: (variables: Record<string, number>) => number;
}

export class BulkQueryError extends Error {}

const glob = (pattern: string) =>
  new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
    'i',
  );

const parseSelector = (text: string): FieldSelector => {
  const match =
    /^\s*(?:([\w.]+)\s*\/\s*)?(\w+)\s*(?:\[\s*(\d+)\s*\])?\s*$/.exec(text);

  if (!match) {
    throw new BulkQueryError(
      `"${text.trim()}" is not a field: write Field, Module/Field or Field[2]`,
    );
  }
  if (match[3] !== undefined && Number(match[3]) < 1) {
    throw new BulkQueryError('Values are counted from 1');
  }
  return {
    module: match[1],
    field: match[2],
    token: match[3] === undefined ? undefined : Number(match[3]) - 1,
  };
};

/** Checks and compiles the four inputs, or explains which is wrong */
export const compileBulkQuery = (query: BulkQuery): CompiledQuery => {
  const [keyword, ...name] = query.blocks.trim().split(/\s+/);

  if (!keyword) {
    throw new BulkQueryError('Name a block keyword, like Object or Weapon');
  }

  const conditions = query.where
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): Condition => {
      const match = /^(.+?)\s*(!=|!~|<=|>=|=|~|<|>)\s*(.+)$/.exec(part);

      if (!match) {
        throw new BulkQueryError(
          `"${part}" is not a condition: write Field = Value, Field ~ Value, Field > 10`,
        );
      }
      return {
        selector: parseSelector(match[1]),
        op: match[2] as Condition['op'],
        value: match[3].trim(),
      };
    });
  let formula: CompiledQuery['formula'];

  try {
    formula = compileExpression(query.formula);
  } catch (error) {
    throw new BulkQueryError((error as Error).message);
  }

  return {
    keyword,
    name: name.length ? glob(name.join(' ')) : undefined,
    conditions,
    field: parseSelector(query.field),
    formula,
  };
};

/** A number as the INI writes it, with an optional `X:` prefix and `%` */
const NUMBER = /^([A-Za-z]:)?(-?(?:\d+\.?\d*|\.\d+))(%?)$/;

const numberOf = (text: string): number | undefined => {
  const match = NUMBER.exec(text);

  return match ? Number(match[2]) : undefined;
};

const write = (before: string, value: number): string => {
  const [, prefix = '', digits, percent] = NUMBER.exec(before)!;
  const integer = !digits.includes('.');
  const text = integer
    ? String(Math.round(value))
    : String(Number(value.toFixed(4)));

  return `${prefix}${text}${percent}`;
};

/** The fields a block holds at any depth, each with the block it sits in */
const fieldsOf = (
  top: SageBlock,
  statements: SageStatement[],
): { statement: SageStatement; owner: SageBlock }[] => {
  const owners = new Map<number, SageBlock>();

  forEachBlock([top], (block) => {
    for (let line = block.startLine + 1; line < block.endLine; line++) {
      owners.set(line, block);
    }
  });
  return statements
    .filter(
      (statement) =>
        statement.kind === 'field' &&
        statement.line > top.startLine &&
        statement.line < top.endLine,
    )
    .map((statement) => ({ statement, owner: owners.get(statement.line)! }));
};

const matches = (
  selector: FieldSelector,
  { statement, owner }: { statement: SageStatement; owner: SageBlock },
  top: SageBlock,
): boolean => {
  if (statement.keyword.text.toLowerCase() !== selector.field.toLowerCase()) {
    return false;
  }
  if (!selector.module) {
    return true;
  }

  const module = selector.module.toLowerCase();

  return (
    owner !== top &&
    [owner.keyword, owner.moduleType, owner.moduleTag].some(
      (each) => each?.toLowerCase() === module,
    )
  );
};

const holds = (
  condition: Condition,
  fields: { statement: SageStatement; owner: SageBlock }[],
  top: SageBlock,
): boolean => {
  const values = fields
    .filter((field) => matches(condition.selector, field, top))
    .flatMap(({ statement }) =>
      condition.selector.token === undefined
        ? statement.values
        : statement.values.slice(
            condition.selector.token,
            condition.selector.token + 1,
          ),
    )
    .map((token) => token.text.replace(/^"|"$/g, ''));
  const wanted = condition.value.toLowerCase();
  const number = Number(condition.value);

  switch (condition.op) {
    case '=':
      return values.length > 0 && values.join(' ').toLowerCase() === wanted;
    case '!=':
      return values.join(' ').toLowerCase() !== wanted;
    case '~':
      return values.some((value) => value.toLowerCase() === wanted);
    case '!~':
      return !values.some((value) => value.toLowerCase() === wanted);
    default: {
      const value = values.map(numberOf).find((each) => each !== undefined);

      if (value === undefined || !Number.isFinite(number)) {
        return false;
      }
      return condition.op === '<'
        ? value < number
        : condition.op === '<='
          ? value <= number
          : condition.op === '>'
            ? value > number
            : value >= number;
    }
  }
};

/** The edits a query makes to one parsed file */
export const bulkChanges = (
  document: SageDocument,
  query: CompiledQuery,
): BulkResult => {
  const result: BulkResult = { changes: [], blocks: 0, skipped: 0 };

  for (const top of document.blocks) {
    if (
      top.keyword.toLowerCase() !== query.keyword.toLowerCase() ||
      (query.name && !query.name.test(top.name ?? ''))
    ) {
      continue;
    }

    const fields = fieldsOf(top, document.statements);

    if (!query.conditions.every((condition) => holds(condition, fields, top))) {
      continue;
    }
    result.blocks++;

    // The block's own numeric fields, by name, for the formula
    const variables: Record<string, number> = {};

    for (const { statement, owner } of fields) {
      const value = numberOf(statement.values[0]?.text ?? '');

      if (
        owner === top &&
        value !== undefined &&
        !(statement.keyword.text in variables)
      ) {
        variables[statement.keyword.text] = value;
      }
    }

    for (const field of fields) {
      if (!matches(query.field, field, top)) {
        continue;
      }

      const tokens =
        query.field.token === undefined
          ? field.statement.values
          : field.statement.values.slice(
              query.field.token,
              query.field.token + 1,
            );

      for (const token of tokens) {
        const x = numberOf(token.text);

        if (x === undefined) {
          result.skipped++;
          continue;
        }

        const after = write(token.text, query.formula({ ...variables, x }));

        if (after !== token.text) {
          result.changes.push({
            line: field.statement.line,
            start: token.start,
            end: token.end,
            before: token.text,
            after,
            block: `${top.keyword} ${top.name ?? ''}`.trim(),
          });
        }
      }
    }
  }
  return result;
};
