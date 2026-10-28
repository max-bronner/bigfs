import {
  evaluateCall,
  evaluateMacroBody,
  formatValue,
} from '../../formats/ini/sageIniPreprocessor';
import type { LookupMacro } from '../../formats/ini/sageIniPreprocessor';
import type { SageBlock, SageDocument, SageStatement } from '../../formats/ini/sageIniParser';

/**
 * The numbers a balance pass compares across units: cost, build time,
 * command points, health, vision, speed, and the primary weapon's damage,
 * range and delay. Each value keeps where it is written, so a table can
 * edit it in place; a child or reskin takes what it does not write from its
 * parent, marked as inherited.
 */

export const STAT_COLUMNS = [
  'side',
  'cost',
  'time',
  'commandPoints',
  'health',
  'vision',
  'speed',
  'armor',
  'weapon',
  'damage',
  'range',
  'delay',
] as const;

export type StatColumn = (typeof STAT_COLUMNS)[number];

/** A value and the token it is written as */
export interface StatValue {
  /** The number a macro or `#ADD` call stands for, else the token itself */
  value: string;
  /** The text at `start`..`end`, when it differs from `value` */
  written?: string;
  line: number;
  start: number;
  end: number;
}

/** What evaluating a number needs: the file's lines and the macros defined */
export interface StatEvaluation {
  lines: string[];
  lookupMacro: LookupMacro;
}

export interface ObjectStats {
  name: string;
  /** `Object`, `ChildObject` or `ObjectReskin` */
  keyword: string;
  /** The template a child or reskin builds on */
  parent?: string;
  startLine: number;
  values: Partial<Record<StatColumn, StatValue>>;
  /** Whether `KindOf` lists `SELECTABLE`, as units and buildings do */
  selectable: boolean;
}

export interface WeaponStats {
  /** The damage when one nugget writes it, so it can be edited in place */
  damage?: StatValue;
  /** The sum of every damage nugget's damage, when more than one writes it */
  damageTotal?: { value: string; nuggets: number };
  range?: StatValue;
  delay?: StatValue;
}

const OBJECT_FIELDS: Record<string, StatColumn> = {
  side: 'side',
  buildcost: 'cost',
  buildtime: 'time',
  commandpoints: 'commandPoints',
  visionrange: 'vision',
};

const parseNumber = (text: string): number | undefined =>
  /^[+-]?(\d+\.?\d*|\.\d+)%?$/.test(text) ? parseFloat(text) : undefined;

/** The number a call or a macro at a token stands for, if it is one */
const evaluateToken = (
  parsed: SageDocument,
  statement: SageStatement,
  token: { text: string; start: number },
  lookupMacro: LookupMacro,
): { value: string; end?: number } | undefined => {
  const call = parsed.calls.find(
    (each) => each.line === statement.line && each.start === token.start,
  );

  if (call) {
    const result = evaluateCall(call, lookupMacro);

    return 'value' in result
      ? { value: formatValue(result.value), end: call.end }
      : undefined;
  }

  const body = lookupMacro(token.text)?.trim();

  if (body === undefined) {
    return undefined;
  }

  const plain = parseNumber(body);
  const result =
    plain === undefined ? evaluateMacroBody(body, lookupMacro) : undefined;

  if (plain !== undefined) {
    return { value: formatValue(plain) };
  }
  return result && 'value' in result
    ? { value: formatValue(result.value) }
    : undefined;
};

/**
 * A statement's token as a value. With `evaluation`, a macro or an `#ADD`
 * call shows the number it stands for, and what is written stays on
 * `written` so an edit can replace it.
 */
const valueOf = (
  statement: SageStatement,
  index = 0,
  parsed?: SageDocument,
  evaluation?: StatEvaluation,
): StatValue | undefined => {
  const token = statement.values[index];

  if (!token) {
    return undefined;
  }

  const evaluated =
    parsed && evaluation
      ? evaluateToken(parsed, statement, token, evaluation.lookupMacro)
      : undefined;
  const end = evaluated?.end ?? token.end;

  return {
    value: evaluated?.value ?? token.text,
    written: evaluated
      ? evaluation!.lines[statement.line]?.slice(token.start, end)
      : undefined,
    line: statement.line,
    start: token.start,
    end,
  };
};

/** The innermost block of `root` holding a line, and the chain to it */
const chainAt = (root: SageBlock, line: number): SageBlock[] => {
  const chain = [root];
  let current = root;

  for (;;) {
    const child = current.children.find(
      (block) => block.startLine < line && line <= block.endLine,
    );

    if (!child) {
      return chain;
    }
    chain.push(child);
    current = child;
  }
};

/** The field statements inside a block, with the block chain holding each */
const fieldsIn = (parsed: SageDocument, root: SageBlock) =>
  parsed.statements
    .filter(
      (statement) =>
        statement.kind === 'field' &&
        statement.line > root.startLine &&
        statement.line < root.endLine,
    )
    .map((statement) => ({
      statement,
      chain: chainAt(root, statement.line).slice(1),
    }));

/** The stats an `Object`, `ChildObject` or `ObjectReskin` block writes */
export const readObjectStats = (
  parsed: SageDocument,
  block: SageBlock,
  evaluation?: StatEvaluation,
): ObjectStats => {
  const [name, parent] = (block.name ?? '').split(/\s+/);
  const stats: ObjectStats = {
    name: name ?? '',
    keyword: block.keyword,
    parent: /^(childobject|objectreskin)$/i.test(block.keyword)
      ? parent
      : undefined,
    startLine: block.startLine,
    values: {},
    selectable: false,
  };
  const set = (column: StatColumn, value: StatValue | undefined) => {
    if (value && !stats.values[column]) {
      stats.values[column] = value;
    }
  };

  for (const { statement, chain } of fieldsIn(parsed, block)) {
    const key = statement.keyword.text.toLowerCase();
    const holder = chain[0]?.keyword.toLowerCase();

    if (!chain.length) {
      if (OBJECT_FIELDS[key]) {
        set(
          OBJECT_FIELDS[key],
          valueOf(
            statement,
            0,
            key === 'side' ? undefined : parsed,
            evaluation,
          ),
        );
      } else if (key === 'kindof') {
        stats.selectable ||= statement.values.some(
          (value) => value.text.toUpperCase() === 'SELECTABLE',
        );
      }
    } else if (holder === 'body' && key === 'maxhealth') {
      set('health', valueOf(statement, 0, parsed, evaluation));
    } else if (holder === 'armorset' && key === 'armor') {
      set('armor', valueOf(statement));
    } else if (holder === 'locomotorset' && key === 'speed') {
      set('speed', valueOf(statement, 0, parsed, evaluation));
    } else if (
      holder === 'weaponset' &&
      key === 'weapon' &&
      statement.values[0]?.text.toUpperCase() === 'PRIMARY'
    ) {
      set('weapon', valueOf(statement, 1));
    }
  }
  return stats;
};

/** A weapon's damage (summed over its damage nuggets), range and delay */
export const readWeaponStats = (
  parsed: SageDocument,
  block: SageBlock,
  evaluation?: StatEvaluation,
): WeaponStats => {
  const stats: WeaponStats = {};
  const nuggets: StatValue[] = [];

  for (const { statement, chain } of fieldsIn(parsed, block)) {
    const key = statement.keyword.text.toLowerCase();

    if (!chain.length && key === 'attackrange') {
      stats.range ??= valueOf(statement, 0, parsed, evaluation);
    } else if (!chain.length && key === 'delaybetweenshots') {
      stats.delay ??= valueOf(statement, 0, parsed, evaluation);
    } else if (
      chain[0]?.keyword.toLowerCase() === 'damagenugget' &&
      key === 'damage'
    ) {
      const damage = valueOf(statement, 0, parsed, evaluation);

      if (damage) {
        nuggets.push(damage);
      }
    }
  }
  if (nuggets.length === 1) {
    stats.damage = nuggets[0];
  } else if (nuggets.length > 1) {
    const numbers = nuggets.map((nugget) => parseNumber(nugget.value));

    stats.damageTotal = {
      value: numbers.every((number) => number !== undefined)
        ? formatValue(numbers.reduce((sum, number) => sum! + number!, 0)!)
        : nuggets.map((nugget) => nugget.value).join(' + '),
      nuggets: nuggets.length,
    };
  }
  return stats;
};
