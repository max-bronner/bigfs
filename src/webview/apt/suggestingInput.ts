import { getVsCodeApi } from '../shared/vscodeApi';
import type { SuggestionKind } from '../../game/apt/engineSuggestions';
import type { FromPage, ToPage } from './protocol';

const vscode = getVsCodeApi<FromPage>();

/**
 * Text fields that offer the game's values as suggestions. The field stays
 * plain text: the user types anything, or picks an option, and a pick is read
 * as typed. Options are asked of the editor when a field is first focused, one
 * list per kind, and kept; a game that is not loaded answers none and the
 * field offers nothing.
 */

const asked = new Set<SuggestionKind>();
const lists = new Map<SuggestionKind, HTMLDataListElement>();

const listFor = (kind: SuggestionKind): HTMLDataListElement => {
  let list = lists.get(kind);

  if (!list) {
    list = document.createElement('datalist');
    list.id = `suggest-${kind}`;
    document.body.append(list);
    lists.set(kind, list);
  }
  return list;
};

/**
 * Makes a field offer the options of a kind. `basis` says, as a tooltip, where
 * the game takes the value from.
 */
export const suggestFrom = (
  field: HTMLInputElement | HTMLTextAreaElement,
  kind: SuggestionKind,
  basis: string,
): void => {
  if (!(field instanceof HTMLInputElement)) {
    return;
  }
  field.setAttribute('list', listFor(kind).id);
  field.title = `Suggestions from the INI. ${basis}`;
  field.addEventListener('focus', () => {
    if (!asked.has(kind) && !listFor(kind).childElementCount) {
      asked.add(kind);
      vscode.postMessage({ kind: 'suggestions', field: kind });
    }
  });
  // A browser that fills the field from its list reports it as an input without text typed
  field.addEventListener('input', (event) => {
    if (!(event instanceof InputEvent) || event.inputType === 'insertReplacementText') {
      field.dispatchEvent(new Event('change'));
    }
  });
};

/** Takes the options the editor found for a kind; an empty answer is asked again at the next focus */
export const suggestionsArrived = (
  data: Extract<ToPage, { kind: 'suggestions' }>,
): void => {
  asked.delete(data.field);
  listFor(data.field).replaceChildren(
    ...data.options.map(({ value, label }) => {
      const option = document.createElement('option');

      option.value = value;
      option.label = label ?? '';
      return option;
    }),
  );
};
