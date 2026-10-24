import type { SageBlock, SageDocument, SageStatement } from './sageIniParser';

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
  value: string;
  line: number;
  start: number;
  end: number;
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
  damage?: StatValue;
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

const valueOf = (
  statement: SageStatement,
  index = 0,
): StatValue | undefined => {
  const token = statement.values[index];

  return (
    token && {
      value: token.text,
      line: statement.line,
      start: token.start,
      end: token.end,
    }
  );
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
        set(OBJECT_FIELDS[key], valueOf(statement));
      } else if (key === 'kindof') {
        stats.selectable ||= statement.values.some(
          (value) => value.text.toUpperCase() === 'SELECTABLE',
        );
      }
    } else if (holder === 'body' && key === 'maxhealth') {
      set('health', valueOf(statement));
    } else if (holder === 'armorset' && key === 'armor') {
      set('armor', valueOf(statement));
    } else if (holder === 'locomotorset' && key === 'speed') {
      set('speed', valueOf(statement));
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

/** A weapon's damage (its first damage nugget), range and delay */
export const readWeaponStats = (
  parsed: SageDocument,
  block: SageBlock,
): WeaponStats => {
  const stats: WeaponStats = {};

  for (const { statement, chain } of fieldsIn(parsed, block)) {
    const key = statement.keyword.text.toLowerCase();

    if (!chain.length && key === 'attackrange') {
      stats.range ??= valueOf(statement);
    } else if (!chain.length && key === 'delaybetweenshots') {
      stats.delay ??= valueOf(statement);
    } else if (
      chain[0]?.keyword.toLowerCase() === 'damagenugget' &&
      key === 'damage'
    ) {
      stats.damage ??= valueOf(statement);
    }
  }
  return stats;
};
