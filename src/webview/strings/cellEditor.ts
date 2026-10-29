import { editorRows, isEdited } from './cellText';

/**
 * Turns a cell into an editor. Enter commits a one-line field, Ctrl+Enter a
 * text; Escape leaves the cell as it was. `leave` runs when nothing is committed.
 */
export const editCell = (
  cell: HTMLElement,
  value: string,
  multiline: boolean,
  commit: (value: string) => void,
  leave: () => void,
): void => {
  const input: HTMLInputElement | HTMLTextAreaElement = multiline
    ? document.createElement('textarea')
    : document.createElement('input');
  let done = false;

  input.value = value;
  if (input instanceof HTMLTextAreaElement) {
    input.rows = editorRows(value);
  }

  const finish = (save: boolean) => {
    if (done) {
      return;
    }
    done = true;
    if (save && isEdited(value, input.value)) {
      commit(input.value);
    } else {
      leave();
    }
  };

  const target: HTMLElement = input;

  target.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      finish(false);
    }
    if (
      event.key === 'Enter' &&
      (!multiline || event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      finish(true);
    }
  });
  target.addEventListener('blur', () => finish(true));
  cell.replaceChildren(input);
  input.focus();
  input.select();
};
