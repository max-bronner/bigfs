import type { SageDocument } from './sageIniParser';

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
