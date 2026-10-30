/** The messages the string table's page and its editors exchange */

/** One row of the string table: a label and its text, as the editor sends it */
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

/** Messages the string table's page sends; `id` and `label` name the row an edit means */
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

/** Messages the editor sends: the whole table, or a notice about a refused edit */
export type StringsToPage =
  | {
      kind: 'table';
      rows: StringRow[];
      hasSpeech: boolean;
      canReveal: boolean;
      summary: string;
    }
  | { kind: 'notice'; message: string };
