import type { MapEdit } from '../../formats/map/mapEdit';
import type {
  DictValue,
  MapLight,
  MapWaypointLink,
} from '../../formats/map/mapFile';
import type { ScriptTreeNode } from '../shared/scriptTreeText';

/** The messages the map editor's page and its editor exchange */

/** One entry of a dictionary: the world's, a player's, a team's or an object's */
export interface DictEntryView {
  key: string;
  value: DictValue;
}

/** A placed object or waypoint */
export interface ObjectView {
  index: number;
  x: number;
  y: number;
  z: number;
  angle: number;
  template: string;
  properties: DictEntryView[];
}

/** A named polygon scripts refer to */
export interface TriggerAreaView {
  name: string;
  id: number;
  points: [number, number][];
}

/** What the page draws of the map, without the terrain heights */
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

/** The terrain: one height sample per cell, row-major */
export interface HeightsView {
  width: number;
  height: number;
  border: number;
  boundaries: [number, number][];
  samples: ArrayLike<number>;
}

/** The map and what the page needs beside it; heights and templates are sent once */
export interface MapMessage {
  kind: 'map';
  readOnly: boolean;
  templates: string[] | undefined;
  map: MapView;
  heights: HeightsView | undefined;
}

/** A refused edit, or an error to show */
export interface MapNotice {
  kind: 'notice' | 'error';
  message: string;
}

export type MapToPage = MapMessage | MapNotice;

/** What the page sends */
export type FromMapPage =
  | { kind: 'ready' }
  | { kind: 'edit'; edit: MapEdit }
  | { kind: 'playSound'; name: string };

/** Whom a dictionary edit means */
export type DictOwner = Extract<MapEdit, { kind: 'dict' }>['owner'];
