import { getVsCodeApi } from '../shared/vscodeApi';
import type {
  FixedSet,
  SuggestionKind,
  SuggestionRule,
} from '../../game/apt/suggestionKinds';
import type { FromPage, ToPage } from './protocol';

const vscode = getVsCodeApi<FromPage>();

/**
 * Text fields that offer the game's values as suggestions. The field stays
 * plain text: the user types anything, or picks an option, and a pick is read
 * as typed. An INI set is asked of the editor when a field is first focused,
 * one list per kind, and kept; a game that is not loaded answers none and the
 * field offers nothing. A set the engine or the movie fixes is carried with
 * its rule and listed at once.
 */

const asked = new Set<SuggestionKind>();
const lists = new Map<string, HTMLDataListElement>();

const listFor = (id: string): HTMLDataListElement => {
  let list = lists.get(id);

  if (!list) {
    list = document.createElement('datalist');
    list.id = `suggest-${id}`;
    document.body.append(list);
    lists.set(id, list);
  }
  return list;
};

const fill = (
  list: HTMLDataListElement,
  options: readonly { value: string; label?: string }[],
): void =>
  list.replaceChildren(
    ...options.map(({ value, label }) => {
      const option = document.createElement('option');

      option.value = value;
      option.label = label ?? '';
      return option;
    }),
  );

const describe = (rule: SuggestionRule): string =>
  'fixed' in rule
    ? `Suggested values. ${rule.basis}.${rule.fixed.isPartial ? ' The list may be partial.' : ''}`
    : `Suggestions from the INI. ${rule.basis}`;

const fixedListFor = ({ id, options }: FixedSet): HTMLDataListElement => {
  const list = listFor(`fixed-${id}`);

  if (!list.childElementCount) {
    fill(list, options);
  }
  return list;
};

/**
 * Makes a field offer the options of a rule. The rule's basis is the tooltip:
 * where the game takes the value from, and whether the list may be partial.
 */
export const suggestFrom = (
  field: HTMLInputElement | HTMLTextAreaElement,
  rule: SuggestionRule,
): void => {
  if (!(field instanceof HTMLInputElement)) {
    return;
  }
  field.title = describe(rule);
  // A browser that fills the field from its list reports it as an input without text typed
  field.addEventListener('input', (event) => {
    if (!(event instanceof InputEvent) || event.inputType === 'insertReplacementText') {
      field.dispatchEvent(new Event('change'));
    }
  });
  if ('fixed' in rule) {
    field.setAttribute('list', fixedListFor(rule.fixed).id);
    return;
  }

  const { kind } = rule;

  field.setAttribute('list', listFor(kind).id);
  field.addEventListener('focus', () => {
    if (!asked.has(kind) && !listFor(kind).childElementCount) {
      asked.add(kind);
      vscode.postMessage({ kind: 'suggestions', field: kind });
    }
  });
};

/** Takes the options the editor found for a kind; an empty answer is asked again at the next focus */
export const suggestionsArrived = (
  data: Extract<ToPage, { kind: 'suggestions' }>,
): void => {
  asked.delete(data.field);
  fill(listFor(data.field), data.options);
};
