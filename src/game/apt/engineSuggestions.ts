/**
 * Which fields of the Engine panel take a value out of the game's INI, and
 * which set. The engine hands a movie such values through calls into the movie
 * and through the pictures it puts on surfaces; the movie does the rest. A
 * field listed here offers that set as suggestions and stays free text. A field
 * whose values are not a known set (a number, a colour, a live game value) is
 * not listed.
 */

/** A set of INI values a field can take */
export type SuggestionKind =
  | 'side'
  | 'sideState'
  | 'factionIcon'
  | 'rankIcon'
  | 'buttonImage';

/** Every kind, for a message from a page to be checked against */
export const SUGGESTION_KINDS: readonly SuggestionKind[] = [
  'side',
  'sideState',
  'factionIcon',
  'rankIcon',
  'buttonImage',
];

/** One suggested value, with a short note beside it */
export interface SuggestionOption {
  value: string;
  label?: string;
}

/** A rule's kind and how sure the rule is */
export interface SuggestionRule {
  kind: SuggestionKind;
  /** Where the game binds the value, and how sure that is */
  basis: string;
}

/** A parameter of a function the engine calls in the movie */
interface ParameterRule extends SuggestionRule {
  /** The function's name, without its path */
  call: RegExp;
  parameter: RegExp;
}

/** The picture of a surface, found by its key */
interface ImageRule extends SuggestionRule {
  key: RegExp;
}

/** Parameters that take a value from the INI, each with the evidence for it */
export const PARAMETER_SUGGESTIONS: readonly ParameterRule[] = [
  {
    call: /^SetPalantirFrameState$/i,
    parameter: /^state$/i,
    kind: 'sideState',
    basis:
      "mint binds _good or _evil from the player template's Evil; the Single forms are the movie's own frames",
  },
  {
    call: /^SetFaction$/i,
    parameter: /^bttnState$/i,
    kind: 'side',
    basis: "mint binds the player template's Side; the movie adds the underscore",
  },
  {
    call: /^SetPlayerFaction$/i,
    parameter: /^faction$/i,
    kind: 'side',
    basis:
      "inferred: retail never calls it; the movie joins an underscore to the player template's Side",
  },
];

/** Surface pictures that take a MappedImage from the INI, each with the evidence for it */
export const IMAGE_SUGGESTIONS: readonly ImageRule[] = [
  {
    key: /FactionIcon/i,
    kind: 'factionIcon',
    basis: 'mint binds AptIcon plus the side',
  },
  {
    key: /(^|\.)UIClip\.Level\.\d+$/i,
    kind: 'rankIcon',
    basis: 'mint binds AptRankIcon plus the side and the level',
  },
  {
    key: /_Image$/i,
    kind: 'buttonImage',
    basis: "mint binds a command button's ButtonImage",
  },
];

/** Finds the suggestions a call's parameter takes */
export const findParameterSuggestion = (
  call: string,
  parameter: string,
): SuggestionRule | undefined =>
  PARAMETER_SUGGESTIONS.find(
    (rule) => rule.call.test(call) && rule.parameter.test(parameter),
  );

/** Finds the suggestions a surface's picture takes, by its key */
export const findImageSuggestion = (key: string): SuggestionRule | undefined =>
  IMAGE_SUGGESTIONS.find((rule) => rule.key.test(key));

/** Names of the `MappedImage`s each picture kind takes */
export const IMAGE_NAME_PATTERNS: Partial<Record<SuggestionKind, RegExp>> = {
  factionIcon: /^AptIcon[A-Za-z]+$/,
  rankIcon: /^AptRankIcon[A-Za-z]*\d+$/,
};

/** The frames `SetPalantirFrameState` has for each side bucket, as the movie names them */
export const PALANTIR_STATES = [
  { value: '_good', evil: false, note: 'good sides' },
  { value: '_evil', evil: true, note: 'evil sides' },
  { value: '_goodSingle', evil: false, note: 'good, single resource bar' },
  { value: '_evilSingle', evil: true, note: 'evil, single resource bar' },
] as const;
