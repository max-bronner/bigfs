import type { MapMode } from './modeText';
import type { HeightsView, MapView } from './protocol';

/** A drag in progress: an object, or one vertex of the chosen trigger area */
export type MapDrag =
  | { kind: 'object'; index: number; moved: boolean }
  | { kind: 'vertex'; area: number; vertex: number; moved: boolean };

/** The terrain shaded once into an off-screen canvas, with its height range */
export interface ReliefSurface {
  surface: HTMLCanvasElement;
  low: number;
  high: number;
}

/** Which layers the map draws */
export interface MapLayers {
  objects: boolean;
  waypoints: boolean;
  links: boolean;
  starts: boolean;
  boundary: boolean;
  areas: boolean;
}

/** Everything the page holds between messages */
export interface MapState {
  map: MapView;
  heights: HeightsView | undefined;
  selected: number | undefined;
  selectedArea: number | undefined;
  filter: string;
  layers: MapLayers;
  relief: ReliefSurface | undefined;
  readOnly: boolean;
  mode: MapMode | undefined;
  /** Points of the trigger area being drawn */
  draft: [number, number][];
  drag: MapDrag | undefined;
  /** The index a placed object will have, to select it when the map comes back */
  pendingSelect: number | undefined;
}

/** A map with nothing in it, which stands in until the editor sends one */
const EMPTY_MAP: MapView = {
  compression: 'none',
  worldInfo: [],
  timeOfDay: undefined,
  lights: undefined,
  teams: [],
  scripts: [],
  triggerAreas: [],
  waypointLinks: [],
  sides: [],
  objects: [],
  chunks: [],
  problems: [],
};

/** The page's state, shared by every module of the map page */
export const state: MapState = {
  map: EMPTY_MAP,
  heights: undefined,
  selected: undefined,
  selectedArea: undefined,
  filter: '',
  layers: {
    objects: true,
    waypoints: true,
    links: true,
    starts: true,
    boundary: true,
    areas: true,
  },
  relief: undefined,
  readOnly: false,
  mode: undefined,
  draft: [],
  drag: undefined,
  pendingSelect: undefined,
};
