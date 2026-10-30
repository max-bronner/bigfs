import { sendEdit } from './messaging';
import { turnedAngle } from './mapModel';
import type { ObjectView } from './protocol';
import { state } from './state';

/** The turn of the rotate buttons and keys, 15 degrees */
export const ROTATE_STEP = Math.PI / 12;

/** Rotates an object by a step. */
export const rotateBy = (object: ObjectView, step: number): void => {
  sendEdit({
    kind: 'object',
    index: object.index,
    angle: turnedAngle(object.angle, step),
  });
};

/** Deletes the selected object, or else the selected trigger area. */
export const deleteSelected = (): void => {
  if (state.readOnly) {
    return;
  }
  if (state.selected !== undefined && state.map.objects[state.selected]) {
    const index = state.selected;

    state.selected = undefined;
    sendEdit({ kind: 'objectDelete', index });
  } else if (state.selectedArea !== undefined) {
    const index = state.selectedArea;

    state.selectedArea = undefined;
    sendEdit({ kind: 'areaDelete', index });
  }
};

/** Adds a waypoint link, or removes it when `present` is false. */
export const toggleLink = (from: number, to: number, present: boolean): void =>
  sendEdit({ kind: 'waypointLink', from, to, present });
