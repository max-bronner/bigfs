/** The messages the string table's page and its editors exchange */

/** One label of the table */
export interface StringRow {
  id: number;
  label: string;
  text: string;
  hasText?: boolean;
  speech?: string;
  /** Strings under the label after the first */
  extra?: number;
  problems?: string[];
}

/** What the page sends: `id` and `label` name the row an edit means */
export type FromStringsPage =
  | { kind: 'ready' }
  | {
      kind: 'setText' | 'setLabel' | 'setSpeech';
      id: number;
      label: string;
      value: string;
    }
  | { kind: 'add'; label: string; value: string }
  | { kind: 'remove'; id: number; label: string }
  | { kind: 'reveal'; id: number };

/** What the editor sends: the whole table, or a notice about a refused edit */
export type StringsToPage =
  | {
      kind: 'table';
      rows: StringRow[];
      hasSpeech: boolean;
      canReveal: boolean;
      summary: string;
    }
  | { kind: 'notice'; message: string };
