import { element } from '../shared/element';
import type { MapActions } from './actions';
import { roundTo } from './mapModel';
import { sendEdit } from './messaging';
import type { TriggerAreaView } from './protocol';
import { state } from './state';

/** The trigger areas as a list; the chosen one is edited by name and points. */
export const createAreaSection = (
  areas: readonly TriggerAreaView[],
  actions: MapActions,
): HTMLDetailsElement => {
  const section = element('details');

  section.append(element('summary', `Trigger areas (${areas.length})`));
  if (state.selectedArea !== undefined) {
    section.open = true;
  }
  if (!state.readOnly) {
    const add = element('button', 'New area');

    add.title = 'Click the map to place points, Enter to finish';
    add.onclick = () => actions.setMode({ kind: 'area' });
    section.append(add);
  }
  areas.forEach((area, index) => {
    const row = element(
      'div',
      `${area.name} · ${area.points.length} points`,
      `object${state.selectedArea === index ? ' selected' : ''}`,
    );

    row.onclick = () => actions.selectArea(index);
    section.append(row);
    if (state.selectedArea !== index) {
      return;
    }
    const edit = (changes: { name?: string; points?: [number, number][] }) =>
      sendEdit({ kind: 'areaSet', index, ...changes });
    const name = element('input');

    name.value = area.name;
    name.disabled = state.readOnly;
    name.onchange = () => edit({ name: name.value });
    const nameRow = element('div', undefined, 'field');

    nameRow.append(element('label', 'Name'), name);
    section.append(nameRow);
    area.points.forEach(([x, y], at) => {
      const line = element('div', undefined, 'light');

      line.append(element('label', `Point ${at + 1}`));
      [x, y].forEach((value, axis) => {
        const input = element('input');

        input.value = String(roundTo(value));
        input.disabled = state.readOnly;
        input.onchange = () => {
          const number = Number(input.value);

          if (input.value.trim() === '' || !Number.isFinite(number)) {
            input.classList.add('invalid');
            return;
          }
          const points = area.points.map(
            (point) => point.slice() as [number, number],
          );

          points[at][axis] = number;
          edit({ points });
        };
        line.append(input);
      });
      if (!state.readOnly) {
        const remove = element('button', '×', 'icon');

        remove.title = 'Remove point';
        remove.onclick = () =>
          edit({ points: area.points.filter((_, other) => other !== at) });
        line.append(remove);
      }
      section.append(line);
    });
    if (!state.readOnly) {
      const bar = element('div');
      const more = element('button', 'Add point');

      more.title = 'Adds a point half way along the closing edge';
      more.onclick = () => {
        const first = area.points[0];
        const last = area.points[area.points.length - 1];

        edit({
          points: [
            ...area.points,
            [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2],
          ],
        });
      };
      const remove = element('button', 'Delete area');

      remove.onclick = () => {
        state.selectedArea = undefined;
        sendEdit({ kind: 'areaDelete', index });
      };
      bar.append(more, remove);
      section.append(bar);
    }
  });
  return section;
};
