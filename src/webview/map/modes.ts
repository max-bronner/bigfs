import { showNotice } from '../shared/noticeBar';
import { canvas } from './elements';
import { draw } from './draw';
import { roundTo, waypointsById } from './mapModel';
import { sendEdit } from './messaging';
import { describeMode, nextAreaName } from './modeText';
import type { MapMode } from './modeText';
import { state } from './state';

/** Template name a waypoint is placed from */
export const WAYPOINT_TEMPLATE = '*Waypoints/Waypoint';

/** Starts placing or drawing, or leaves the mode with none */
export const setMode = (mode: MapMode | undefined): void => {
  state.mode = mode;
  state.draft = [];
  canvas.style.cursor = mode ? 'copy' : 'crosshair';
  document.getElementById('hint')!.textContent = describeMode(mode);
  document.getElementById('modebar')!.hidden = !mode;
  draw();
};

/** Adds the area being drawn, once it has three points */
export const finishArea = (): void => {
  if (!state.mode || state.mode.kind !== 'area') {
    return;
  }
  if (state.draft.length < 3) {
    showNotice('A trigger area has at least three points');
    return;
  }
  const taken = new Set(state.map.triggerAreas.map((area) => area.name));

  sendEdit({
    kind: 'areaAdd',
    name: nextAreaName(taken),
    points: state.draft,
  });
  state.selectedArea = state.map.triggerAreas.length;
  setMode(undefined);
};

/** Places the object or waypoint of the mode at a world position; a waypoint takes the next free id */
export const placeAt = (x: number, y: number): void => {
  const mode = state.mode;

  if (mode?.kind !== 'place') {
    return;
  }
  const properties = mode.waypoint
    ? (() => {
        const ids = [...waypointsById(state.map.objects).keys()];
        const id = ids.length ? Math.max(...ids) + 1 : 1;

        return [
          { key: 'waypointID', value: { type: 'int' as const, value: id } },
          {
            key: 'waypointName',
            value: { type: 'string' as const, value: `Waypoint ${id}` },
          },
        ];
      })()
    : [
        {
          key: 'objectInitialHealth',
          value: { type: 'int' as const, value: 100 },
        },
        { key: 'objectEnabled', value: { type: 'bool' as const, value: true } },
      ];

  state.pendingSelect = state.map.objects.length;
  sendEdit({
    kind: 'objectAdd',
    template: mode.template,
    x: roundTo(x),
    y: roundTo(y),
    properties,
  });
  setMode(undefined);
};
