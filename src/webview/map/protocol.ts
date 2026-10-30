import type { MapEdit } from '../../formats/map/mapEdit';
import type {
  DictValue,
  MapLight,
  MapWaypointLink,
} from '../../formats/map/mapFile';
import type { ScriptTreeNode } from '../shared/scriptTreeText';

/** The messages the map editor's page and its editor exchange */

/** One entry of a map dictionary: the world's, a player's, a team's or an object's */
export interface DictEntryView {
  key: string;
  value: DictValue;
}

/** One placed object or waypoint; `index` is its position in the map's object list */
export interface ObjectView {
  index: number;
  x: number;
  y: number;
  z: number;
  angle: number;
  template: string;
  properties: DictEntryView[];
}

/** One trigger area: a named polygon scripts refer to */
export interface TriggerAreaView {
  name: string;
  id: number;
  points: [number, number][];
}

/** The map as the page shows it, without the terrain heights */
export interface MapView {
  compression: 'ear' | 'none';
  worldInfo: DictEntryView[];
  timeOfDay: number | undefined;
  lights: MapLight[] | undefined;
  teams: DictEntryView[][];
  scripts: ScriptTreeNode[][];
  triggerAreas: TriggerAreaView[];
  waypointLinks: MapWaypointLink[];
  sides: DictEntryView[][];
  objects: ObjectView[];
  chunks: { name: string; version: number; size: number }[];
  problems: string[];
}

/** Terrain height map: one height sample per cell, row-major, the south row first */
export interface HeightsView {
  width: number;
  height: number;
  border: number;
  boundaries: [number, number][];
  samples: ArrayLike<number>;
}

/** Message carrying the map and what the page needs beside it; heights and templates are sent once */
export interface MapMessage {
  kind: 'map';
  readOnly: boolean;
  templates: string[] | undefined;
  map: MapView;
  heights: HeightsView | undefined;
}

/** Notice the editor sends: a refused edit, or an error to show */
export interface MapNotice {
  kind: 'notice' | 'error';
  message: string;
}

/** Messages the editor sends to the map page */
export type MapToPage = MapMessage | MapNotice;

/** Messages the map page sends to its editor */
export type FromMapPage =
  | { kind: 'ready' }
  | { kind: 'edit'; edit: MapEdit }
  | { kind: 'playSound'; name: string };

/** Owner of the dictionary an edit changes: the world, a player, a team or an object */
export type DictOwner = Extract<MapEdit, { kind: 'dict' }>['owner'];
