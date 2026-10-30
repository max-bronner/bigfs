import type { MapActions } from './actions';
import { canvas } from './elements';
import { draw, project, unproject } from './draw';
import {
  idOf,
  insidePolygon,
  isStart,
  isWaypoint,
  roundTo,
} from './mapModel';
import { sendEdit } from './messaging';
import { finishArea, placeAt, setMode } from './modes';
import { ROTATE_STEP, deleteSelected, rotateBy, toggleLink } from './objectEdits';
import type { ObjectView } from './protocol';
import { state } from './state';

/** The squared distance, in pixels, within which a click picks an object */
const PICK_OBJECT_DISTANCE = 100;

/** The squared distance, in pixels, within which a click picks a trigger area's vertex */
const PICK_VERTEX_DISTANCE = 64;

const canvasPoint = (event: MouseEvent): [number, number] => {
  const rect = canvas.getBoundingClientRect();

  return [
    ((event.clientX - rect.left) * canvas.width) / rect.width,
    ((event.clientY - rect.top) * canvas.height) / rect.height,
  ];
};

const isLayerShown = (object: ObjectView): boolean =>
  isStart(object)
    ? state.layers.starts
    : isWaypoint(object)
      ? state.layers.waypoints
      : state.layers.objects;

const nearestObject = ([x, y]: [number, number]): ObjectView | undefined => {
  let best: ObjectView | undefined;
  let bestDistance = PICK_OBJECT_DISTANCE;

  for (const object of state.map.objects) {
    if (!isLayerShown(object)) {
      continue;
    }
    const [px, py] = project(object.x, object.y);
    const distance = (px - x) ** 2 + (py - y) ** 2;

    if (distance < bestDistance) {
      best = object;
      bestDistance = distance;
    }
  }
  return best;
};

const nearestVertex = ([x, y]: [number, number]): number | undefined => {
  const area =
    state.selectedArea === undefined
      ? undefined
      : state.map.triggerAreas[state.selectedArea];

  if (!area || !state.layers.areas) {
    return undefined;
  }
  let best: number | undefined;
  let bestDistance = PICK_VERTEX_DISTANCE;

  area.points.forEach((point, index) => {
    const [px, py] = project(point[0], point[1]);
    const distance = (px - x) ** 2 + (py - y) ** 2;

    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
};

const onMouseDown = (event: MouseEvent, actions: MapActions) => {
  if (!state.heights || event.button !== 0 || state.mode) {
    return;
  }
  const at = canvasPoint(event);
  const vertex = nearestVertex(at);

  if (vertex !== undefined && !state.readOnly) {
    state.drag = {
      kind: 'vertex',
      area: state.selectedArea!,
      vertex,
      moved: false,
    };
    return;
  }
  const object = nearestObject(at);
  const chosen =
    state.selected === undefined ? undefined : state.map.objects[state.selected];

  if (
    object &&
    event.altKey &&
    chosen &&
    isWaypoint(chosen) &&
    isWaypoint(object) &&
    object !== chosen
  ) {
    if (!state.readOnly) {
      const from = idOf(chosen);
      const to = idOf(object);
      const present = state.map.waypointLinks.some(
        (link) => link.from === from && link.to === to,
      );

      if (from !== undefined && to !== undefined) {
        toggleLink(from, to, !present);
      }
    }
    return;
  }
  if (object) {
    actions.select(object.index);
    if (!state.readOnly) {
      state.drag = { kind: 'object', index: object.index, moved: false };
    }
    return;
  }
  const world = unproject(at[0], at[1]);
  const index = state.layers.areas
    ? state.map.triggerAreas.findIndex((area) =>
        insidePolygon(world, area.points),
      )
    : -1;

  if (index >= 0) {
    actions.selectArea(index);
  }
};

const onMouseMove = (event: MouseEvent) => {
  const drag = state.drag;

  if (!drag) {
    return;
  }
  const [x, y] = unproject(...canvasPoint(event));

  drag.moved = true;
  if (drag.kind === 'object') {
    const object = state.map.objects[drag.index];

    object.x = x;
    object.y = y;
  } else {
    state.map.triggerAreas[drag.area].points[drag.vertex] = [x, y];
  }
  draw();
};

const onMouseUp = () => {
  const drag = state.drag;

  state.drag = undefined;
  if (!drag || !drag.moved) {
    return;
  }
  if (drag.kind === 'object') {
    const object = state.map.objects[drag.index];

    sendEdit({
      kind: 'object',
      index: drag.index,
      x: roundTo(object.x),
      y: roundTo(object.y),
    });
  } else {
    const area = state.map.triggerAreas[drag.area];

    sendEdit({
      kind: 'areaSet',
      index: drag.area,
      points: area.points.map(([x, y]) => [roundTo(x), roundTo(y)]),
    });
  }
};

const onClick = (event: MouseEvent) => {
  if (!state.heights || !state.mode || state.readOnly) {
    return;
  }
  const [x, y] = unproject(...canvasPoint(event));

  if (state.mode.kind === 'place') {
    placeAt(x, y);
  } else {
    state.draft.push([roundTo(x), roundTo(y)]);
    draw();
  }
};

const onKeyDown = (event: KeyboardEvent) => {
  if (
    ['INPUT', 'SELECT', 'TEXTAREA'].includes(
      document.activeElement?.tagName ?? '',
    )
  ) {
    return;
  }
  if (event.key === 'Escape') {
    setMode(undefined);
  } else if (event.key === 'Enter') {
    finishArea();
  } else if (
    event.key === 'Backspace' &&
    state.mode &&
    state.mode.kind === 'area'
  ) {
    state.draft.pop();
    draw();
  } else if (event.key === 'Delete') {
    deleteSelected();
  } else if ((event.key === '[' || event.key === ']') && !state.readOnly) {
    const object =
      state.selected === undefined ? undefined : state.map.objects[state.selected];

    if (object) {
      rotateBy(object, event.key === '[' ? ROTATE_STEP : -ROTATE_STEP);
    }
  }
};

/** Listens to the mouse on the map and the keys on the page. */
export const listenToCanvas = (actions: MapActions): void => {
  canvas.addEventListener('mousedown', (event) => onMouseDown(event, actions));
  canvas.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('click', onClick);
  window.addEventListener('keydown', onKeyDown);
};
