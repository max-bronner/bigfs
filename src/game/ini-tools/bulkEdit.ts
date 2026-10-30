import { compileExpression } from '../../core/expression';
import { forEachBlock } from '../../formats/ini/sageIniParser';
import type {
  SageBlock,
  SageDocument,
  SageMacroDefinition,
  SageStatement,
  SageToken,
} from '../../formats/ini/sageIniParser';

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

/** A bulk edit as the user writes it: the four inputs described above, uncompiled */
export interface BulkQuery {
  blocks: string;
  where: string;
  field: string;
  formula: string;
}

/** One token edit a bulk query makes, for the preview and the workspace edit */
export interface BulkChange {
  /** The file to edit: where the value is defined, which may not be where the block is */
  uri: string;
  line: number;
  start: number;
  end: number;
  before: string;
  after: string;
  /** The top-level block it belongs to, for the preview */
  block: string;
  /** Set when the value is defined elsewhere than the block writes it */
  via?: string;
}

/** The edits a bulk query makes and the counts the preview reports */
export interface BulkResult {
  changes: BulkChange[];
  /** Blocks that matched the selection and the conditions */
  blocks: number;
  /** Matching values that are not numbers (a name) and were left */
  skipped: number;
  /** Matching values that cannot be edited where they are defined, and why */
  unresolved: string[];
  /** Edits made in a macro, an included file or a parent object, not the block */
  redirected: number;
}

/** One parsed file of the workspace, named by its uri */
export interface BulkSource {
  uri: string;
  document: SageDocument;
}

/** What a query reads beyond the file a block sits in */
export interface BulkWorkspace {
  sources: readonly BulkSource[];
  /** Reads the parsed fragment an `#include` in `from` names, when it can be read */
  include(from: BulkSource, path: string): BulkSource | undefined;
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

/** A bulk query checked and compiled by `compileBulkQuery`, ready to run */
export interface CompiledQuery {
  keyword: string;
  name?: RegExp;
  conditions: Condition[];
  field: FieldSelector;
  formula: (variables: Record<string, number>) => number;
}

/** Error thrown for a bulk query input the user wrote wrong; its message says which */
export class BulkQueryError extends Error {}

const globToRegExp = (pattern: string) =>
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

/**
 * Checks and compiles the four inputs.
 * @throws BulkQueryError naming the input that is wrong
 */
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
    name: name.length ? globToRegExp(name.join(' ')) : undefined,
    conditions,
    field: parseSelector(query.field),
    formula,
  };
};

/** A number as the INI writes it, with an optional `X:` prefix and `%` */
const NUMBER = /^([A-Za-z]:)?(-?(?:\d+\.?\d*|\.\d+))(%?)$/;

const parseIniNumber = (text: string): number | undefined => {
  const match = NUMBER.exec(text);

  return match ? Number(match[2]) : undefined;
};

const formatNumberLike = (before: string, value: number): string => {
  const [, prefix = '', digits, percent] = NUMBER.exec(before)!;
  const integer = !digits.includes('.');
  const text = integer
    ? String(Math.round(value))
    : String(Number(value.toFixed(4)));

  return `${prefix}${text}${percent}`;
};

interface FieldRef {
  source: BulkSource;
  statement: SageStatement;
  /** The module the field sits in; none when it is the object's own */
  owner?: SageBlock;
}

const MAX_DEPTH = 16;
const PARENT_KEYWORDS = /^(?:childobject|objectreskin)$/i;
const OBJECT_KEYWORDS = /^(?:object|childobject|objectreskin)$/i;

/** A top-level block with the file it sits in */
interface Unit {
  source: BulkSource;
  block: SageBlock;
}

const matches = (selector: FieldSelector, { statement, owner }: FieldRef) => {
  if (statement.keyword.text.toLowerCase() !== selector.field.toLowerCase()) {
    return false;
  }
  if (!selector.module) {
    return true;
  }

  const module = selector.module.toLowerCase();

  return (
    owner !== undefined &&
    [owner.keyword, owner.moduleType, owner.moduleTag].some(
      (each) => each?.toLowerCase() === module,
    )
  );
};

interface Resolved {
  text: string;
  /** Where the number is written, which is a macro's body when it is named */
  target: { source: BulkSource; line: number; start: number; end: number };
  via?: string;
}

/** Creates the reader a query runs over a workspace, with macros, includes and inheritance resolved */
const createReader = (workspace: BulkWorkspace) => {
  const macros = new Map<
    string,
    { source: BulkSource; macro: SageMacroDefinition }
  >();
  const loaded = new Set<BulkSource>();
  const tops = new Map<string, Unit>();

  const load = (source: BulkSource, depth = 0) => {
    if (loaded.has(source) || depth > MAX_DEPTH) {
      return;
    }
    loaded.add(source);
    for (const macro of source.document.macros) {
      const key = macro.name.toLowerCase();

      // The first definition of a name wins, as the engine reads them in order
      if (!macros.has(key)) {
        macros.set(key, { source, macro });
      }
    }
    for (const include of source.document.includes) {
      const target = workspace.include(source, include.path);

      if (target) {
        load(target, depth + 1);
      }
    }
  };

  for (const source of workspace.sources) {
    load(source);
    for (const block of source.document.blocks) {
      const name = /^\S+/.exec(block.name ?? '')?.[0];

      if (OBJECT_KEYWORDS.test(block.keyword) && name) {
        const key = name.toLowerCase();

        if (!tops.has(key)) {
          tops.set(key, { source, block });
        }
      }
    }
  }

  const findMacro = (token: SageToken, from: BulkSource) => {
    const local = from.document.macros.find(
      (macro) => macro.name.toLowerCase() === token.text.toLowerCase(),
    );

    return local
      ? { source: from, macro: local }
      : macros.get(token.text.toLowerCase());
  };

  // The number a value stands for and where it is written, following macros
  const resolve = (
    token: SageToken,
    line: number,
    from: BulkSource,
  ): Resolved | { problem: string } | undefined => {
    let text = token.text;
    let target = { source: from, line, start: token.start, end: token.end };
    let via: string | undefined;

    for (let hops = 0; !NUMBER.test(text) && hops < MAX_DEPTH; hops++) {
      const found = findMacro({ ...token, text }, target.source);

      if (!found) {
        break;
      }

      const body = found.macro.value.trim();

      via = via ?? text;
      target = {
        source: found.source,
        line: found.macro.line,
        start: found.macro.valueStart,
        end: found.macro.valueStart + body.length,
      };
      if (!/^\S+$/.test(body)) {
        return {
          problem: `${via} is a macro whose body "${body}" is not one number`,
        };
      }
      text = body;
    }
    return via || NUMBER.test(text) ? { text, target, via } : undefined;
  };

  const fieldsIn = (
    source: BulkSource,
    base: SageBlock | undefined,
    rootOwner: SageBlock | undefined,
    seen: Set<BulkSource>,
    depth: number,
  ): FieldRef[] => {
    const document = source.document;
    const owners = new Map<number, SageBlock>();
    const range = (block: SageBlock) => {
      for (let line = block.startLine + 1; line < block.endLine; line++) {
        owners.set(line, block);
      }
    };

    forEachBlock(base ? [base] : document.blocks, range);

    const inside = (line: number) =>
      base ? line > base.startLine && line < base.endLine : true;
    const ownerOf = (line: number) => {
      const owner = owners.get(line);

      return owner === undefined || owner === base ? rootOwner : owner;
    };
    const fields = document.statements
      .filter(
        (statement) => statement.kind === 'field' && inside(statement.line),
      )
      .map(
        (statement): FieldRef => ({
          source,
          statement,
          owner: ownerOf(statement.line),
        }),
      );

    if (depth < MAX_DEPTH) {
      for (const include of document.includes) {
        const fragment = inside(include.line)
          ? workspace.include(source, include.path)
          : undefined;

        if (fragment && !seen.has(fragment)) {
          fields.push(
            ...fieldsIn(
              fragment,
              undefined,
              ownerOf(include.line),
              new Set([...seen, fragment]),
              depth + 1,
            ),
          );
        }
      }
    }
    return fields;
  };

  const ownCache = new Map<SageBlock, FieldRef[]>();
  const readOwnFields = (unit: Unit) => {
    let fields = ownCache.get(unit.block);

    if (!fields) {
      fields = fieldsIn(unit.source, unit.block, undefined, new Set(), 0);
      ownCache.set(unit.block, fields);
    }
    return fields;
  };

  const findParent = (unit: Unit): Unit | undefined => {
    const parent = PARENT_KEYWORDS.test(unit.block.keyword)
      ? (unit.block.name ?? '').split(/\s+/)[1]
      : undefined;

    return parent ? tops.get(parent.toLowerCase()) : undefined;
  };

  // The fields a selector picks on a block: its own, or when it writes none,
  // those of the parent it inherits from, which are where they are defined
  const select = (
    unit: Unit,
    selector: FieldSelector,
    inheritedFrom?: Unit,
  ): { field: FieldRef; inheritedFrom?: Unit }[] => {
    const found = readOwnFields(unit).filter((field) => matches(selector, field));

    if (found.length) {
      return found.map((field) => ({ field, inheritedFrom }));
    }

    const parent = findParent(unit);
    let hops = 0;

    return parent && hops++ < MAX_DEPTH && parent.block !== unit.block
      ? select(parent, selector, inheritedFrom ?? parent)
      : [];
  };

  return { resolve, own: readOwnFields, select, parentOf: findParent, macroOf: findMacro };
};

const expand = (
  reader: ReturnType<typeof createReader>,
  token: SageToken,
  line: number,
  source: BulkSource,
): string => {
  const resolved = reader.resolve(token, line, source);

  return resolved && 'text' in resolved ? resolved.text : token.text;
};

/** Plans the edits a query makes across a workspace of parsed files */
export const planBulkChangesAcross = (
  workspace: BulkWorkspace,
  query: CompiledQuery,
): BulkResult => {
  const result: BulkResult = {
    changes: [],
    blocks: 0,
    skipped: 0,
    unresolved: [],
    redirected: 0,
  };
  const reader = createReader(workspace);
  const written = new Set<string>();
  const problems = new Set<string>();

  const holds = (condition: Condition, unit: Unit): boolean => {
    const values = reader
      .select(unit, condition.selector)
      .flatMap(({ field }) =>
        (condition.selector.token === undefined
          ? field.statement.values
          : field.statement.values.slice(
              condition.selector.token,
              condition.selector.token + 1,
            )
        ).map((token) =>
          expand(reader, token, field.statement.line, field.source).replace(
            /^"|"$/g,
            '',
          ),
        ),
      );
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
        const value = values.map(parseIniNumber).find((each) => each !== undefined);

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

  for (const source of workspace.sources) {
    for (const block of source.document.blocks) {
      if (
        block.keyword.toLowerCase() !== query.keyword.toLowerCase() ||
        (query.name && !query.name.test(block.name ?? ''))
      ) {
        continue;
      }

      const unit: Unit = { source, block };

      if (!query.conditions.every((condition) => holds(condition, unit))) {
        continue;
      }
      result.blocks++;

      // The block's own numeric fields, by name, for the formula; a parent's
      // fill in the names the block does not write
      const variables: Record<string, number> = {};
      const lineage: Unit[] = [];

      for (
        let each: Unit | undefined = unit;
        each && lineage.length < MAX_DEPTH && !lineage.includes(each);
        each = reader.parentOf(each)
      ) {
        lineage.push(each);
      }
      for (const level of lineage.reverse()) {
        for (const { source: from, statement, owner } of reader.own(level)) {
          const resolved = statement.values[0]
            ? reader.resolve(statement.values[0], statement.line, from)
            : undefined;

          if (
            owner === undefined &&
            resolved &&
            'text' in resolved &&
            NUMBER.test(resolved.text)
          ) {
            variables[statement.keyword.text] = parseIniNumber(resolved.text)!;
          }
        }
      }

      const label = `${block.keyword} ${block.name ?? ''}`.trim();

      for (const { field, inheritedFrom } of reader.select(unit, query.field)) {
        const tokens =
          query.field.token === undefined
            ? field.statement.values
            : field.statement.values.slice(
                query.field.token,
                query.field.token + 1,
              );

        for (const token of tokens) {
          if (
            field.source.document.calls.some(
              (call) =>
                call.line === field.statement.line &&
                token.start >= call.start &&
                token.end <= call.end,
            )
          ) {
            problems.add(
              `line ${field.statement.line + 1} of ${field.source.uri || 'the file'} is computed by a #ADD-style call; edit its operands by hand`,
            );
            continue;
          }

          const resolved = reader.resolve(
            token,
            field.statement.line,
            field.source,
          );

          if (resolved && 'problem' in resolved) {
            problems.add(resolved.problem);
            continue;
          }
          if (!resolved || !NUMBER.test(resolved.text)) {
            result.skipped++;
            continue;
          }

          const x = parseIniNumber(resolved.text)!;
          const after = formatNumberLike(
            resolved.text,
            query.formula({ ...variables, x }),
          );
          const { target } = resolved;
          const key = `${target.source.uri}:${target.line}:${target.start}`;

          if (after === resolved.text || written.has(key)) {
            continue;
          }
          written.add(key);

          const via = [
            resolved.via ? `macro ${resolved.via}` : undefined,
            field.source !== unit.source ? 'included file' : undefined,
            inheritedFrom
              ? `inherited from ${inheritedFrom.block.name?.split(/\s+/)[0]}`
              : undefined,
          ]
            .filter(Boolean)
            .join(', ');

          if (via) {
            result.redirected++;
          }
          result.changes.push({
            uri: target.source.uri,
            line: target.line,
            start: target.start,
            end: target.end,
            before: resolved.text,
            after,
            block: label,
            via: via || undefined,
          });
        }
      }
    }
  }
  result.unresolved = [...problems];
  return result;
};

/** Plans the edits a query makes to one parsed file, with no other file in reach */
export const planBulkChanges = (
  document: SageDocument,
  query: CompiledQuery,
): BulkResult =>
  planBulkChangesAcross(
    { sources: [{ uri: '', document }], include: () => undefined },
    query,
  );
