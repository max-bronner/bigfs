import { element } from '../shared/element';
import type { MapActions } from './actions';
import { objectList } from './elements';
import { filterObjects, nameOf } from './mapModel';
import { state } from './state';

/** The most objects the list shows; the filter narrows the rest */
const MAX_LISTED = 500;

/** Draws the right panel's list of objects, filtered and capped. */
export const showObjects = (actions: MapActions): void => {
  const matches = filterObjects(state.map.objects, state.filter);

  document.getElementById('objectCount')!.textContent =
    `${matches.length} of ${state.map.objects.length}`;
  objectList.replaceChildren(
    ...matches.slice(0, MAX_LISTED).map((object) => {
      const row = element(
        'div',
        undefined,
        `object${state.selected === object.index ? ' selected' : ''}`,
      );

      row.append(element('span', object.template), element('span', nameOf(object), 'muted'));
      row.onclick = () => actions.select(object.index);
      return row;
    }),
  );
  if (matches.length > MAX_LISTED) {
    objectList.append(element('p', 'Showing 500; filter to narrow.', 'muted'));
  }
};
