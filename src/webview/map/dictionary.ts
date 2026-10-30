import { element } from '../shared/element';
import { sendEdit } from './messaging';
import type { DictEntryView, DictOwner } from './protocol';
import { state } from './state';
import type { DictValue } from '../../formats/map/mapFile';

/** Creates an editor for one dictionary value, committing on change */
const valueInput = (
  entry: DictEntryView,
  onCommit: (value: DictValue) => void,
): HTMLInputElement => {
  const value = entry.value;

  if (value.type === 'bool') {
    const box = element('input');

    box.type = 'checkbox';
    box.checked = value.value;
    box.disabled = state.readOnly;
    box.onchange = () => onCommit({ type: 'bool', value: box.checked });
    return box;
  }
  const field = element('input');

  field.value =
    value.type === 'real'
      ? String(Math.round(value.value * 1e6) / 1e6)
      : String(value.value);
  field.disabled = state.readOnly;
  field.onchange = () => {
    if (value.type === 'int' || value.type === 'real') {
      const number = Number(field.value);

      if (
        !Number.isFinite(number) ||
        (value.type === 'int' && !Number.isInteger(number))
      ) {
        field.classList.add('invalid');
        return;
      }
      onCommit({ type: value.type, value: number });
    } else {
      onCommit({ type: value.type, value: field.value });
    }
  };
  return field;
};

/** Creates a table of a dictionary's entries, each editable; `removable` adds a button that removes a property */
export const createDictTable = (
  entries: readonly DictEntryView[],
  owner: DictOwner,
  removable?: boolean,
): HTMLTableElement => {
  const table = element('table', undefined, 'dict');

  for (const entry of entries) {
    const row = element('tr');
    const key = element('td', entry.key, 'key');

    key.title = entry.value.type;
    const cell = element('td');

    cell.append(
      valueInput(entry, (value) =>
        sendEdit({ kind: 'dict', owner, key: entry.key, value }),
      ),
    );
    row.append(key, cell);
    if (removable && !state.readOnly) {
      const remove = element('button', '×', 'icon');

      remove.title = `Remove ${entry.key}`;
      remove.onclick = () =>
        sendEdit({ kind: 'property', owner, key: entry.key, value: null });
      const end = element('td');

      end.append(remove);
      row.append(end);
    }
    table.append(row);
  }
  if (!entries.length) {
    const row = element('tr');

    row.append(element('td', 'no properties', 'muted'));
    table.append(row);
  }
  return table;
};
