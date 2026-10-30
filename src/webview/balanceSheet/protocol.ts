import type { StatColumn } from '../../game/objects/objectStats';

export interface SheetCell {
  value: string;
  /** Where the value is written; absent when nothing writes it */
  uri?: string;
  line?: number;
  start?: number;
  end?: number;
  /** The template it is inherited from */
  from?: string;
  /** How many rows read this same weapon value */
  shared?: number;
  /** How a computed value is worked out; it is not written anywhere */
  derived?: string;
  /** What is written at the place, when the value is evaluated from it */
  written?: string;
}

export interface SheetRow {
  name: string;
  keyword: string;
  parent?: string;
  uri: string;
  line: number;
  selectable: boolean;
  cells: Partial<Record<StatColumn | 'dps', SheetCell>>;
}

/** What the page sends: a row and a column by name, never a place in a file */
export type FromSheetPage =
  | { kind: 'ready' }
  | { kind: 'refresh' }
  | { kind: 'open'; row: string }
  | { kind: 'edit'; row: string; column: string; old: string; value: string };

export type ToSheetPage =
  | { kind: 'loading' }
  | { kind: 'notice'; message: string }
  | { kind: 'rows'; columns: (StatColumn | 'dps')[]; rows: SheetRow[] };
