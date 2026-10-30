import { element } from '../shared/element';
import type { MapActions } from './actions';
import { createDictTable } from './dictionary';
import { objectDetails } from './elements';
import {
  getWaypointId,
  isWaypoint,
  parseValue,
  formatWaypointLabel,
  waypointsById,
} from './mapModel';
import { sendEdit } from './messaging';
import type { ObjectView } from './protocol';
import { ROTATE_STEP, deleteSelected, rotateBy, toggleLink } from './objectEdits';
import { state } from './state';
import type { DictValue } from '../../formats/map/mapFile';

const createNumberField = (
  label: string,
  value: number,
  onCommit: (value: number) => void,
): HTMLDivElement => {
  const row = element('div', undefined, 'field');
  const field = element('input');

  field.value = String(Math.round(value * 1000) / 1000);
  field.disabled = state.readOnly;
  field.onchange = () => {
    const number = Number(field.value);

    if (!Number.isFinite(number)) {
      field.classList.add('invalid');
      return;
    }
    onCommit(number);
  };
  row.append(element('label', label), field);
  return row;
};

/** Creates a field for a text, whole number or real property the object may not have yet; clearing it removes the property */
const createPropertyField = (
  object: ObjectView,
  label: string,
  key: string,
  type: DictValue['type'],
  list?: string,
): HTMLDivElement => {
  const entry = object.properties.find((candidate) => candidate.key === key);
  const row = element('div', undefined, 'field');
  const field = element('input');

  if (list) {
    field.setAttribute('list', list);
  }
  field.value = entry ? String(entry.value.value) : '';
  field.placeholder = entry ? '' : 'not set';
  field.disabled = state.readOnly;
  field.onchange = () => {
    const owner = { object: object.index };

    if (field.value.trim() === '') {
      sendEdit({ kind: 'property', owner, key, value: null });
      return;
    }
    const value = parseValue(entry ? entry.value.type : type, field.value);

    if (!value) {
      field.classList.add('invalid');
      return;
    }
    sendEdit({ kind: 'property', owner, key, value });
  };
  row.append(element('label', label), field);
  return row;
};

const createAddPropertyRow = (object: ObjectView): HTMLDivElement => {
  const row = element('div', undefined, 'addproperty');
  const key = element('input');

  key.setAttribute('list', 'propertyKeys');
  key.placeholder = 'property';
  const type = element('select');

  for (const name of ['string', 'int', 'real', 'bool', 'wide']) {
    type.append(element('option', name));
  }
  const value = element('input');

  value.placeholder = 'value';
  const add = element('button', 'Add');

  add.onclick = () => {
    const parsed = parseValue(type.value as DictValue['type'], value.value);

    if (!key.value.trim() || !parsed) {
      (parsed ? key : value).classList.add('invalid');
      return;
    }
    sendEdit({
      kind: 'property',
      owner: { object: object.index },
      key: key.value.trim(),
      value: parsed,
    });
  };
  row.append(key, type, value, add);
  return row;
};

const createWaypointLinkSection = (object: ObjectView, actions: MapActions): HTMLDivElement => {
  const id = getWaypointId(object);
  const section = element('div');

  if (id === undefined) {
    return section;
  }
  const ids = waypointsById(state.map.objects);

  section.append(element('h3', 'Links'));
  const links = state.map.waypointLinks;
  const rows = [
    ...links
      .filter((link) => link.from === id)
      .map((link) => ({ link, arrow: '→', other: ids.get(link.to), otherId: link.to })),
    ...links
      .filter((link) => link.to === id)
      .map((link) => ({ link, arrow: '←', other: ids.get(link.from), otherId: link.from })),
  ];

  for (const { link, arrow, other, otherId } of rows) {
    const line = element(
      'div',
      `${arrow} ${other ? formatWaypointLabel(other) : `missing #${otherId}`}`,
      'object',
    );

    if (other) {
      line.onclick = () => actions.select(other.index);
    }
    if (!state.readOnly) {
      const remove = element('button', '×', 'icon');

      remove.title = 'Remove this link';
      remove.onclick = (event) => {
        event.stopPropagation();
        toggleLink(link.from, link.to, false);
      };
      line.append(remove);
    }
    section.append(line);
  }
  if (!rows.length) {
    section.append(element('p', 'No links', 'muted'));
  }
  if (!state.readOnly) {
    const target = element('select');

    for (const [otherId, other] of ids) {
      if (otherId !== id) {
        target.append(
          Object.assign(element('option', formatWaypointLabel(other)), {
            value: String(otherId),
          }),
        );
      }
    }
    const add = element('button', 'Link to');

    add.title =
      'Alt-click a waypoint on the map does the same, and removes a link that is there';
    add.onclick = () => {
      if (target.value !== '') {
        toggleLink(id, Number(target.value), true);
      }
    };
    const bar = element('div', undefined, 'addproperty');

    bar.append(add, target);
    section.append(bar);
  }
  return section;
};

/** Renders the details of the selected object under the list: placement, properties and, for a waypoint, its links */
export const showObject = (actions: MapActions): void => {
  const object =
    state.selected === undefined ? undefined : state.map.objects[state.selected];

  objectDetails.replaceChildren();
  if (!object) {
    return;
  }
  const waypoint = isWaypoint(object);

  objectDetails.append(
    element('h3', `${waypoint ? 'Waypoint ' : 'Object '}${object.index}`),
  );
  if (!state.readOnly) {
    const bar = element('div', undefined, 'toolbar');
    const left = element('button', '⟲ 15°');

    left.onclick = () => rotateBy(object, ROTATE_STEP);
    const right = element('button', '⟳ 15°');

    right.onclick = () => rotateBy(object, -ROTATE_STEP);
    const remove = element('button', 'Delete');

    remove.title = 'Delete key';
    remove.onclick = deleteSelected;
    bar.append(left, right, remove);
    objectDetails.append(bar);
  }
  const template = element('div', undefined, 'field');
  const templateField = element('input');

  templateField.setAttribute('list', 'templates');
  templateField.value = object.template;
  templateField.disabled = state.readOnly;
  templateField.onchange = () =>
    sendEdit({ kind: 'object', index: object.index, template: templateField.value });
  template.append(element('label', 'Template'), templateField);
  objectDetails.append(
    template,
    createNumberField('X', object.x, (value) =>
      sendEdit({ kind: 'object', index: object.index, x: value }),
    ),
    createNumberField('Y', object.y, (value) =>
      sendEdit({ kind: 'object', index: object.index, y: value }),
    ),
    createNumberField('Z offset', object.z, (value) =>
      sendEdit({ kind: 'object', index: object.index, z: value }),
    ),
    createNumberField('Angle °', (object.angle * 180) / Math.PI, (value) =>
      sendEdit({
        kind: 'object',
        index: object.index,
        angle: (value * Math.PI) / 180,
      }),
    ),
    createPropertyField(object, 'Owner / team', 'originalOwner', 'string', 'owners'),
    createPropertyField(object, 'Health %', 'objectInitialHealth', 'int'),
    createPropertyField(
      object,
      waypoint ? 'Waypoint name' : 'Name',
      waypoint ? 'waypointName' : 'objectName',
      'string',
    ),
  );
  if (waypoint) {
    objectDetails.append(createWaypointLinkSection(object, actions));
  }
  objectDetails.append(
    element('h3', 'Properties'),
    createDictTable(object.properties, { object: object.index }, true),
  );
  if (!state.readOnly) {
    objectDetails.append(createAddPropertyRow(object));
  }
};
