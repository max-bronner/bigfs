import {
  FIXED_BINDING_RULES,
  FIXED_EXTERN_RULES,
  FIXED_PARAMETER_RULES,
} from './fixedSuggestionRules';
import {
  EXTERN_RULES,
  IMAGE_RULES,
  PARAMETER_RULES,
} from './iniSuggestionRules';
import type { SuggestionRule } from './suggestionKinds';

/**
 * Which fields of the Engine panel offer a set of values, and which set. The
 * engine hands a movie such values through calls into the movie, externs and
 * the pictures it puts on surfaces; the movie does the rest. A field listed
 * here offers its set as suggestions and stays free text. A field whose values
 * are not a known set (a number, a name the player types, a live game value)
 * is listed in no table.
 */

/** Finds the suggestions a call's parameter takes */
export const findParameterSuggestion = (
  call: string,
  parameter: string,
): SuggestionRule | undefined =>
  [...PARAMETER_RULES, ...FIXED_PARAMETER_RULES].find(
    (rule) => rule.call.test(call) && rule.parameter.test(parameter),
  );

/** Finds the suggestions a surface's picture takes, by its key */
export const findImageSuggestion = (key: string): SuggestionRule | undefined =>
  IMAGE_RULES.find((rule) => rule.name.test(key));

/** Finds the suggestions an extern's value takes, by its name */
export const findExternSuggestion = (
  name: string,
): SuggestionRule | undefined =>
  [...EXTERN_RULES, ...FIXED_EXTERN_RULES].find((rule) => rule.name.test(name));

/** Finds the suggestions a gadget's bound variable takes, by its name */
export const findBindingSuggestion = (
  name: string,
): SuggestionRule | undefined =>
  FIXED_BINDING_RULES.find((rule) => rule.name.test(name));

/** The frames `SetPalantirFrameState` has for each side bucket, as the movie names them */
export const PALANTIR_STATES = [
  { value: '_good', evil: false, note: 'good sides' },
  { value: '_evil', evil: true, note: 'evil sides' },
  { value: '_goodSingle', evil: false, note: 'good, single resource bar' },
  { value: '_evilSingle', evil: true, note: 'evil, single resource bar' },
] as const;
