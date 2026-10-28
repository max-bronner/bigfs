import type { SageDocument } from '../../formats/ini/sageIniParser';

/**
 * Every `Armor` definition as one row of a table: how much of each damage
 * type it lets through, as its `Armor = TYPE 50%` lines write it. A type
 * a row does not write takes its `DEFAULT` line, as the game reads it.
 */

export interface ArmorCell {
  value: string;
  line: number;
  start: number;
  end: number;
}

export interface ArmorRow {
  name: string;
  uri: string;
  startLine: number;
  endLine: number;
  /** By damage type as written, upper-cased */
  cells: Record<string, ArmorCell>;
  /** Indentation its lines use, for a line added to it */
  indent: string;
}

export const readArmorRows = (
  parsed: SageDocument,
  lines: string[],
  uri: string,
): ArmorRow[] =>
  parsed.blocks
    .filter((block) => block.keyword.toLowerCase() === 'armor' && block.name)
    .map((block) => {
      const cells: Record<string, ArmorCell> = {};
      let indent = '  ';

      for (const statement of parsed.statements) {
        if (
          statement.kind !== 'field' ||
          statement.line <= block.startLine ||
          statement.line >= block.endLine ||
          statement.keyword.text.toLowerCase() !== 'armor'
        ) {
          continue;
        }

        const [type, value] = statement.values;

        if (type && value) {
          cells[type.text.toUpperCase()] = {
            value: value.text,
            line: statement.line,
            start: value.start,
            end: value.end,
          };
          indent = /^\s*/.exec(lines[statement.line])![0];
        }
      }
      return {
        name: block.name!.split(/\s+/)[0],
        uri,
        startLine: block.startLine,
        endLine: block.endLine,
        cells,
        indent,
      };
    });

/** Every damage type any row writes, DEFAULT first */
export const damageTypes = (rows: ArmorRow[]): string[] => {
  const types = new Set(rows.flatMap((row) => Object.keys(row.cells)));

  types.delete('DEFAULT');
  return ['DEFAULT', ...[...types].sort()];
};

/** What a cell shows: the armor's value against a type, and whether it is its own */
export interface ArmorShown {
  value: string;
  /** True when the armor writes no line that takes effect for the type */
  inherited: boolean;
}

/** What the game reads when an armor writes no `DEFAULT` line */
const UNARMORED = '100%';

/**
 * The game reads an armor's lines in file order, and a `DEFAULT` line sets
 * every type at the point it is read: a type line before it is overwritten,
 * one after it wins. A type neither line reaches lets everything through.
 */
export const shownArmor = (row: ArmorRow, type: string): ArmorShown => {
  const own = row.cells[type];
  const fallback = row.cells.DEFAULT;

  if (own && (type === 'DEFAULT' || !fallback || own.line > fallback.line)) {
    return { value: own.value, inherited: false };
  }
  return { value: fallback?.value ?? UNARMORED, inherited: true };
};

/** The change that makes an armor let `value` of a type through */
export type ArmorEdit =
  | { kind: 'replace'; line: number; start: number; end: number; old: string }
  | { kind: 'insert'; line: number; text: string };

/**
 * Where the value of a type is written. A line a later `DEFAULT` overwrites
 * is not taken over; a new line goes last so it wins, except `DEFAULT`,
 * which goes first so it does not wipe the types already written.
 */
export const armorEdit = (
  row: ArmorRow,
  type: string,
  value: string,
  eol = '\n',
): ArmorEdit => {
  const cell = row.cells[type];

  if (cell && !shownArmor(row, type).inherited) {
    return {
      kind: 'replace',
      line: cell.line,
      start: cell.start,
      end: cell.end,
      old: cell.value,
    };
  }
  return {
    kind: 'insert',
    line: type === 'DEFAULT' ? row.startLine + 1 : row.endLine,
    text: `${row.indent}Armor = ${type} ${value}${eol}`,
  };
};

/** A percentage as the INI writes it, from what a person typed */
export const armorValue = (typed: string): string | undefined => {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*%?\s*$/.exec(typed);

  return match ? `${Number(match[1])}%` : undefined;
};

/** Messages between the armor table and its page */
export interface ArmorTableMessage {
  kind: 'table';
  types: string[];
  rows: ArmorRow[];
}

export type FromArmorPage =
  | { kind: 'ready' }
  | { kind: 'set'; armor: string; type: string; value: string }
  | { kind: 'reveal'; armor: string };
