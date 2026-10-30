import type { StatColumn } from '../../game/objects/objectStats';

/** One value of the balance sheet, with where it is written when it can be edited */
export interface SheetCell {
  value: string;
  /** Where the value is written; absent when nothing writes it */
  uri?: string;
  line?: number;
  start?: number;
  end?: number;
  /** The template it is inherited from; absent when the row writes it itself */
  from?: string;
  /** How many rows read this same weapon value */
  shared?: number;
  /** How a computed value is worked out; it is not written anywhere */
  derived?: string;
  /** What is written at the place, when the value is evaluated from it */
  written?: string;
}

/** One object template of the balance sheet and its values by column */
export interface SheetRow {
  name: string;
  keyword: string;
  parent?: string;
  uri: string;
  line: number;
  selectable: boolean;
  cells: Partial<Record<StatColumn | 'dps', SheetCell>>;
}

/** Messages the balance sheet's page sends; a row and a column are named, never a place in a file */
export type FromSheetPage =
  | { kind: 'ready' }
  | { kind: 'refresh' }
  | { kind: 'open'; row: string }
  | { kind: 'edit'; row: string; column: string; old: string; value: string };

/** Messages the extension sends to the balance sheet's page */
export type ToSheetPage =
  | { kind: 'loading' }
  | { kind: 'notice'; message: string }
  | { kind: 'rows'; columns: (StatColumn | 'dps')[]; rows: SheetRow[] };
