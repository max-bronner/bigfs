import { editCell } from './cellEditor';
import type { FromStringsPage, StringRow } from './protocol';
import { ROWS_PER_PAGE, describeCount, filterRows } from './rowFilter';

/** What the table shows: the rows the editor sent, and how much of them */
export interface TableState {
  rows: StringRow[];
  hasSpeech: boolean;
  canReveal: boolean;
  filter: string;
  page: number;
}

const cell = (text: string, className?: string): HTMLTableCellElement => {
  const element = document.createElement('td');

  element.textContent = text;
  if (className) {
    element.className = className;
  }
  return element;
};

/** Draws the table body, the count and "Show more" for the current state. */
export const renderTable = (
  state: TableState,
  post: (message: FromStringsPage) => void,
  redraw: () => void,
): void => {
  const visible = filterRows(state.rows, state.filter);
  const shown = visible.slice(0, (state.page + 1) * ROWS_PER_PAGE);

  document.getElementById('count')!.textContent = describeCount(
    visible.length,
    state.rows.length,
  );
  document.getElementById('more')!.hidden = shown.length >= visible.length;
  document.getElementById('speechHead')!.hidden = !state.hasSpeech;
  document.getElementById('rows')!.replaceChildren(
    ...shown.map((row) => {
      const tr = document.createElement('tr');
      const hasProblems = Boolean(row.problems?.length);

      if (hasProblems) {
        tr.className = 'problem';
      }
      const label = cell(row.label, 'label');

      if (hasProblems) {
        label.title = row.problems!.join('; ');
      }
      label.ondblclick = () =>
        editCell(
          label,
          row.label,
          false,
          (value) =>
            post({ kind: 'setLabel', id: row.id, label: row.label, value }),
          redraw,
        );
      const textCell = cell(
        row.text,
        `text${row.hasText === false ? ' missing' : ''}`,
      );

      if (row.extra) {
        textCell.title = `${row.extra} more string(s) under this label, which the game does not read`;
      }
      textCell.ondblclick = () =>
        editCell(
          textCell,
          row.text,
          true,
          (value) =>
            post({ kind: 'setText', id: row.id, label: row.label, value }),
          redraw,
        );
      tr.append(label, textCell);
      if (state.hasSpeech) {
        const speech = cell(row.speech ?? '', 'speech');

        speech.ondblclick = () =>
          editCell(
            speech,
            row.speech ?? '',
            false,
            (value) =>
              post({ kind: 'setSpeech', id: row.id, label: row.label, value }),
            redraw,
          );
        tr.append(speech);
      }
      const actions = document.createElement('td');

      actions.className = 'actions';
      if (state.canReveal) {
        const reveal = document.createElement('button');

        reveal.textContent = '↗';
        reveal.title = 'Show in the text';
        reveal.onclick = () => post({ kind: 'reveal', id: row.id });
        actions.append(reveal);
      }
      const remove = document.createElement('button');

      remove.textContent = '×';
      remove.title = 'Remove this label';
      remove.onclick = () =>
        post({ kind: 'remove', id: row.id, label: row.label });
      actions.append(remove);
      tr.append(actions);
      return tr;
    }),
  );
};
