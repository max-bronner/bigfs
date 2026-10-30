import { showNotice } from '../shared/noticeBar';
import type { MapActions } from './actions';
import { listenToCanvas } from './canvasInput';
import { buildRelief, draw } from './draw';
import { canvas } from './elements';
import { showInfo } from './infoPanel';
import { ownerOf } from './mapModel';
import { vscode } from './messaging';
import { WAYPOINT_TEMPLATE, finishArea, setMode } from './modes';
import { showObject } from './objectDetails';
import { showObjects } from './objectList';
import type { MapToPage } from './protocol';
import { state } from './state';

/**
 * The map editor's page: the terrain as a shaded relief with objects,
 * waypoints and start positions over it, the map's settings and players,
 * and the placed objects with their properties. Changes go to the extension
 * as edits; it sends the map back.
 */

/** Property names the "add property" box suggests */
const PROPERTY_KEYS = [
  'uniqueID',
  'objectLayer',
  'objectInitialHealth',
  'objectEnabled',
  'objectIndestructible',
  'objectUnsellable',
  'objectPowered',
  'objectRecruitableAI',
  'objectTargetable',
  'objectBasePriority',
  'objectBasePhase',
  'exportWithScript',
  'alignToTerrain',
  'objectPrototypeScale',
  'objectName',
  'originalOwner',
  'waypointName',
  'waypointPathLabel1',
  'waypointPathLabel2',
  'waypointPathLabel3',
  'waypointPathBiDirectional',
];

const fillList = (id: string, values: readonly string[]) => {
  document.getElementById(id)!.replaceChildren(
    ...values.map((value) =>
      Object.assign(document.createElement('option'), { value }),
    ),
  );
};

const refresh = () => {
  showInfo(actions);
  showObjects(actions);
  showObject(actions);
  draw();
};

const actions: MapActions = {
  select(index) {
    state.selected = index;
    if (index !== undefined) {
      state.selectedArea = undefined;
    }
    refresh();
  },
  selectArea(index) {
    state.selectedArea = index;
    state.selected = index === undefined ? state.selected : undefined;
    refresh();
  },
  setMode,
};

const templateInput = document.getElementById('template') as HTMLInputElement;
const startPlace = (waypoint: boolean) => {
  const template = waypoint ? WAYPOINT_TEMPLATE : templateInput.value.trim();

  if (!template) {
    showNotice('Pick an object template to place');
    return;
  }
  setMode({ kind: 'place', template, waypoint });
};

document.getElementById('placeObject')!.onclick = () => startPlace(false);
document.getElementById('placeWaypoint')!.onclick = () => startPlace(true);
document.getElementById('finishMode')!.onclick = finishArea;
document.getElementById('cancelMode')!.onclick = () => setMode(undefined);
fillList('propertyKeys', PROPERTY_KEYS);

document.getElementById('filter')!.addEventListener('input', (event) => {
  state.filter = (event.target as HTMLInputElement).value;
  showObjects(actions);
});
for (const name of Object.keys(state.layers) as (keyof typeof state.layers)[]) {
  const box = document.getElementById(`layer-${name}`) as HTMLInputElement;

  box.checked = state.layers[name];
  box.onchange = () => {
    state.layers[name] = box.checked;
    draw();
  };
}
listenToCanvas(actions);
new ResizeObserver(() => draw()).observe(canvas.parentElement!);

/** Lists the owners and teams the "owner" box suggests: those the objects and teams name */
const ownerNames = (): string[] =>
  [
    ...new Set([
      ...state.map.objects.map(ownerOf).filter(Boolean),
      ...state.map.teams
        .map((team) => team.find((entry) => entry.key === 'teamName')?.value.value)
        .filter(Boolean)
        .map(String),
    ]),
  ].sort();

window.addEventListener('message', ({ data }: MessageEvent<MapToPage>) => {
  if (data.kind === 'map') {
    state.map = data.map;
    state.readOnly = Boolean(data.readOnly);
    document.body.classList.toggle('readonly', state.readOnly);
    if (data.templates) {
      fillList('templates', data.templates);
    }
    if (data.heights) {
      state.heights = data.heights;
      state.relief = buildRelief(data.heights);
    }
    if (state.pendingSelect !== undefined) {
      if (state.map.objects.length > state.pendingSelect) {
        actions.select(state.pendingSelect);
      }
      state.pendingSelect = undefined;
    }
    if (state.selected !== undefined && !state.map.objects[state.selected]) {
      state.selected = undefined;
    }
    if (
      state.selectedArea !== undefined &&
      !state.map.triggerAreas[state.selectedArea]
    ) {
      state.selectedArea = undefined;
    }
    fillList('owners', ownerNames());
    refresh();
  } else if (data.kind === 'notice' || data.kind === 'error') {
    showNotice(data.message);
  }
});

vscode.postMessage({ kind: 'ready' });
