/**
 * The sets of values the Engine panel can offer for a field. A set is either
 * read out of the game's INI (a `SuggestionKind`, asked of the editor) or fixed
 * by the engine or the movie and carried with the rule (a `FixedSet`).
 */

/** A set of INI values a field can take */
export type SuggestionKind =
  | 'side'
  | 'sideState'
  | 'factionIcon'
  | 'rankIcon'
  | 'buttonImage'
  | 'powerIcon'
  | 'spellImage'
  | 'classIcon'
  | 'typeIcon'
  | 'heroImage'
  | 'unitPortrait'
  | 'colourHex'
  | 'colourArgb';

/** Every kind, for a message from a page to be checked against */
export const SUGGESTION_KINDS: readonly SuggestionKind[] = [
  'side',
  'sideState',
  'factionIcon',
  'rankIcon',
  'buttonImage',
  'powerIcon',
  'spellImage',
  'classIcon',
  'typeIcon',
  'heroImage',
  'unitPortrait',
  'colourHex',
  'colourArgb',
];

/** One suggested value, with a short note beside it */
export interface SuggestionOption {
  value: string;
  label?: string;
}

/** A set of values the engine or the movie fixes, carried with the rule that names it */
export interface FixedSet {
  /** Names the set's list on the page */
  id: string;
  options: readonly SuggestionOption[];
  /** Whether other values are known to exist: the field says so in its tooltip */
  isPartial?: boolean;
}

/** Where a field's suggestions come from, and how sure that is */
export type SuggestionRule = { basis: string } & (
  | { kind: SuggestionKind }
  | { fixed: FixedSet }
);

/** A parameter of a function the engine calls in the movie */
export type ParameterRule = SuggestionRule & {
  /** The function's name, without its path */
  call: RegExp;
  parameter: RegExp;
};

/** A field found by its name: a surface key, an extern or a gadget variable */
export type NamedRule = SuggestionRule & { name: RegExp };
