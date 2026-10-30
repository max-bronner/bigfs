import {
  Dict,
  DictEntry,
  DictValue,
  MapFile,
  MapScriptNode,
  MapTriggerArea,
  MapWaypointLink,
  findChunk,
  parseMapBody,
  spliceMap,
  writeDict,
} from './mapFile';
import { encodeWindows1252 } from '../../core/windows1252';

/**
 * Edits to a parsed map. Each one splices the decompressed body, so every
 * chunk the edit does not name keeps its bytes, and returns the map read
 * again. A name a new record needs is appended to the name table.
 */

/** Object property key that holds a waypoint's id, which waypoint links name */
export const WAYPOINT_ID_KEY = 'waypointID';

type DictOwner =
  | 'world'
  | { side: number }
  | { object: number }
  | { team: number };

/** A described map edit, as the map editor asks for it before it is applied */
export type MapEdit =
  | { kind: 'timeOfDay'; value: number }
  | {
      kind: 'dict';
      owner: DictOwner;
      key: string;
      value: DictValue;
    }
  | {
      /** Sets a property, adding it if the dictionary lacks it; `null` removes it */
      kind: 'property';
      owner: DictOwner;
      key: string;
      value: DictValue | null;
    }
  | {
      kind: 'object';
      index: number;
      x?: number;
      y?: number;
      z?: number;
      angle?: number;
      template?: string;
    }
  | {
      kind: 'objectAdd';
      template: string;
      x: number;
      y: number;
      z?: number;
      angle?: number;
      properties?: { key: string; value: DictValue }[];
    }
  | { kind: 'objectDelete'; index: number }
  | { kind: 'waypointLink'; from: number; to: number; present: boolean }
  | {
      kind: 'areaSet';
      index: number;
      name?: string;
      points?: [number, number][];
    }
  | { kind: 'areaAdd'; name: string; points: [number, number][] }
  | { kind: 'areaDelete'; index: number }
  | { kind: 'scriptActive'; at: number; active: boolean }
  | {
      kind: 'light';
      /** 0 morning to 3 night */
      config: number;
      field: 'ambient' | 'color' | 'direction';
      value: [number, number, number];
    };

/** No chunk holds a span added at the end of the body */
const OUTSIDE_ANY_CHUNK = { start: -1, end: -1 };

const NO_BYTES = new Uint8Array(0);

const join = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
};

const u16 = (value: number): Uint8Array =>
  Uint8Array.of(value & 255, (value >>> 8) & 255);

const u32 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4);

  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);

  return bytes;
};

const f32s = (...values: number[]): Uint8Array =>
  new Uint8Array(new Float32Array(values).buffer);

/** Encodes a string as the map stores it: a `u16` length and the Windows-1252 bytes */
const mapString = (text: string): Uint8Array => {
  const bytes = encodeWindows1252(text);

  if (bytes.length > 0xffff) {
    throw new Error('A map string holds up to 65,535 characters');
  }

  return join(u16(bytes.length), bytes);
};

const requireFinite = (label: string, ...values: number[]): void => {
  if (!values.every(Number.isFinite)) {
    throw new Error(`${label} must be a number`);
  }
};

const templateName = (text: string): string => {
  const template = text.trim();

  if (!template || /[^\x20-\x7e]/.test(template)) {
    throw new Error('A template name is plain ASCII');
  }

  return template;
};

const nameIndex = (map: MapFile, name: string): number | undefined => {
  for (const [index, existing] of map.names) {
    if (existing === name) {
      return index;
    }
  }

  return undefined;
};

/** Interns `name`, returning the map with it in its name table and the index it has there */
const internName = (
  map: MapFile,
  name: string,
): { map: MapFile; index: number } => {
  const existing = nameIndex(map, name);

  if (existing !== undefined) {
    return { map, index: existing };
  }

  if (!/^[\x20-\x7e]{1,255}$/.test(name)) {
    throw new Error(`${name} is not a name a map can hold`);
  }

  const index = Math.max(0, ...map.names.keys()) + 1;

  if (index >= 1 << 23) {
    throw new Error('The name table is full');
  }

  const count = new DataView(
    map.body.buffer,
    map.body.byteOffset,
    map.body.byteLength,
  ).getUint32(4, true);
  const entry = join(
    Uint8Array.of(name.length),
    Uint8Array.from(name, (char) => char.charCodeAt(0)),
    u32(index),
  );
  const body = join(
    map.body.subarray(0, 4),
    u32(count + 1),
    map.body.subarray(8, map.namesEnd),
    entry,
    map.body.subarray(map.namesEnd),
  );

  return { map: parseMapBody(body, map.compression), index };
};

/** Appends a chunk to the end of a container, or of the body when it names none */
const appendChunk = (
  map: MapFile,
  container: string | undefined,
  name: string,
  version: number,
  payload: Uint8Array,
): MapFile => {
  const { map: named, index } = internName(map, name);
  const parent = container ? findChunk(named.chunks, container) : undefined;

  if (container && !parent) {
    throw new Error(`This map has no ${container}`);
  }

  const at = parent ? parent.end : named.body.length;

  return spliceMap(
    named,
    at,
    at,
    join(u32(index), u16(version), u32(payload.length), payload),
    parent ?? OUTSIDE_ANY_CHUNK,
  );
};

const ownerDict = (map: MapFile, owner: DictOwner): Dict | undefined =>
  owner === 'world'
    ? map.worldInfo
    : 'side' in owner
      ? map.sides[owner.side]
      : 'team' in owner
        ? map.teams[owner.team]
        : map.objects[owner.object]?.properties;

const checkValue = (key: string, value: DictValue): void => {
  if (
    (value.type === 'bool' && typeof value.value !== 'boolean') ||
    ((value.type === 'int' || value.type === 'real') &&
      !Number.isFinite(value.value)) ||
    (value.type === 'int' && !Number.isInteger(value.value)) ||
    ((value.type === 'string' || value.type === 'wide') &&
      typeof value.value !== 'string')
  ) {
    throw new Error(`${key} does not hold that ${value.type}`);
  }

  if (
    value.type === 'int' &&
    (value.value > 0x7fffffff || value.value < -0x80000000)
  ) {
    throw new Error(`${key} is a 32-bit whole number`);
  }
};

/** Builds an `Object` chunk's payload; the dictionary's names must already be interned */
const objectPayload = (
  edit: Extract<MapEdit, { kind: 'objectAdd' }>,
  keyIndexes: number[],
): Uint8Array =>
  join(
    f32s(edit.x, edit.y, edit.z ?? 0, edit.angle ?? 0),
    u32(0),
    mapString(templateName(edit.template)),
    writeDict(
      (edit.properties ?? []).map(({ key, value }, at) => ({
        key,
        keyIndex: keyIndexes[at],
        value,
      })),
    ),
  );

const addObject = (
  map: MapFile,
  edit: Extract<MapEdit, { kind: 'objectAdd' }>,
): MapFile => {
  requireFinite('A position', edit.x, edit.y, edit.z ?? 0, edit.angle ?? 0);

  let next = map;
  const keyIndexes: number[] = [];

  for (const { key, value } of edit.properties ?? []) {
    checkValue(key, value);

    const interned = internName(next, key);

    next = interned.map;
    keyIndexes.push(interned.index);
  }

  const payload = objectPayload(edit, keyIndexes);

  if (!findChunk(next.chunks, 'ObjectsList')) {
    next = appendChunk(next, undefined, 'ObjectsList', 3, NO_BYTES);
  }

  return appendChunk(next, 'ObjectsList', 'Object', 3, payload);
};

const waypointIdOf = (properties: Dict): number | undefined => {
  const entry = properties.entries.find(
    (candidate) => candidate.key === WAYPOINT_ID_KEY,
  );

  return entry?.value.type === 'int' ? entry.value.value : undefined;
};

const linksPayload = (links: MapWaypointLink[]): Uint8Array =>
  join(
    u32(links.length),
    ...links.map(({ from, to }) => join(u32(from), u32(to))),
  );

const setLinks = (map: MapFile, links: MapWaypointLink[]): MapFile => {
  const chunk = map.waypointLinksChunk;

  if (chunk) {
    return spliceMap(map, chunk.start, chunk.end, linksPayload(links));
  }

  if (findChunk(map.chunks, 'WaypointsList')) {
    throw new Error('The waypoint links could not be read, so they are kept');
  }

  return links.length
    ? appendChunk(map, undefined, 'WaypointsList', 1, linksPayload(links))
    : map;
};

const deleteObject = (map: MapFile, index: number): MapFile => {
  const object = map.objects[index];

  if (!object) {
    throw new Error('There is no such object');
  }

  const id = waypointIdOf(object.properties);
  const next = spliceMap(map, object.chunk.header, object.chunk.end, NO_BYTES);

  // A link to a waypoint nobody holds the id of is dead weight the game skips
  if (
    id !== undefined &&
    !next.objects.some((other) => waypointIdOf(other.properties) === id) &&
    next.waypointLinks.some((link) => link.from === id || link.to === id)
  ) {
    return setLinks(
      next,
      next.waypointLinks.filter((link) => link.from !== id && link.to !== id),
    );
  }

  return next;
};

const setLink = (
  map: MapFile,
  edit: Extract<MapEdit, { kind: 'waypointLink' }>,
): MapFile => {
  const same = (link: MapWaypointLink) =>
    link.from === edit.from && link.to === edit.to;
  const present = map.waypointLinks.some(same);

  if (!edit.present) {
    return present
      ? setLinks(
          map,
          map.waypointLinks.filter((link) => !same(link)),
        )
      : map;
  }

  if (edit.from === edit.to) {
    throw new Error('A waypoint cannot link to itself');
  }

  const ids = new Set(map.objects.map((o) => waypointIdOf(o.properties)));

  if (!ids.has(edit.from) || !ids.has(edit.to)) {
    throw new Error('A link joins two waypoints that are in the map');
  }

  return present
    ? map
    : setLinks(map, [...map.waypointLinks, { from: edit.from, to: edit.to }]);
};

const writeAreas = (areas: MapTriggerArea[]): Uint8Array =>
  join(
    u32(areas.length),
    ...areas.map((area) =>
      join(
        mapString(area.name),
        mapString(area.layerName),
        u32(area.id),
        u32(area.points.length),
        ...area.points.map(([x, y]) => f32s(x, y)),
        u32(area.trailing),
      ),
    ),
  );

const setAreas = (map: MapFile, areas: MapTriggerArea[]): MapFile => {
  const span = map.triggerAreaSpan;

  if (span) {
    return spliceMap(map, span[0], span[1], writeAreas(areas));
  }

  if (findChunk(map.chunks, 'TriggerAreas')) {
    throw new Error('The trigger areas could not be read, so they are kept');
  }

  return appendChunk(map, undefined, 'TriggerAreas', 1, writeAreas(areas));
};

const checkArea = (name: string, points: [number, number][]): void => {
  if (!name.trim()) {
    throw new Error('A trigger area needs a name');
  }

  if (points.length < 3) {
    throw new Error('A trigger area has at least three points');
  }

  requireFinite('A point', ...points.flat());
};

const editArea = (
  map: MapFile,
  edit: Extract<MapEdit, { kind: 'areaSet' | 'areaAdd' | 'areaDelete' }>,
): MapFile => {
  const areas = map.triggerAreas;

  if (edit.kind === 'areaAdd') {
    checkArea(edit.name, edit.points);

    const id = Math.max(-1, ...areas.map((area) => area.id)) + 1;

    return setAreas(map, [
      ...areas,
      {
        name: edit.name,
        layerName: '',
        id,
        points: edit.points,
        trailing: 0,
      },
    ]);
  }

  const area = areas[edit.index];

  if (!area) {
    throw new Error('There is no such trigger area');
  }

  if (edit.kind === 'areaDelete') {
    return setAreas(
      map,
      areas.filter((_, at) => at !== edit.index),
    );
  }

  const changed = {
    ...area,
    name: edit.name ?? area.name,
    points: edit.points ?? area.points,
  };

  checkArea(changed.name, changed.points);

  return setAreas(
    map,
    areas.map((candidate, at) => (at === edit.index ? changed : candidate)),
  );
};

const setProperty = (
  map: MapFile,
  edit: Extract<MapEdit, { kind: 'property' }>,
): MapFile => {
  const dict = ownerDict(map, edit.owner);

  if (!dict) {
    throw new Error('There is no such dictionary');
  }

  const entry = dict.entries.find((candidate) => candidate.key === edit.key);

  if (edit.value === null) {
    return entry
      ? spliceMap(
          map,
          dict.start,
          dict.end,
          writeDict(dict.entries.filter((candidate) => candidate !== entry)),
        )
      : map;
  }

  checkValue(edit.key, edit.value);

  if (entry && entry.value.type !== edit.value.type) {
    throw new Error(
      `${edit.key} holds a ${entry.value.type}, not a ${edit.value.type}`,
    );
  }

  if (entry) {
    return spliceMap(
      map,
      dict.start,
      dict.end,
      writeDict(
        dict.entries.map((candidate) =>
          candidate === entry ? { ...entry, value: edit.value! } : candidate,
        ),
      ),
    );
  }

  const { map: named, index } = internName(map, edit.key);
  const target = ownerDict(named, edit.owner);

  if (!target) {
    throw new Error('There is no such dictionary');
  }

  const added: DictEntry = {
    key: edit.key,
    keyIndex: index,
    value: edit.value,
  };

  return spliceMap(
    named,
    target.start,
    target.end,
    writeDict([...target.entries, added]),
  );
};

const moveObject = (
  map: MapFile,
  edit: Extract<MapEdit, { kind: 'object' }>,
): MapFile => {
  const object = map.objects[edit.index];

  if (!object) {
    throw new Error('There is no such object');
  }

  const next = {
    x: edit.x ?? object.x,
    y: edit.y ?? object.y,
    z: edit.z ?? object.z,
    angle: edit.angle ?? object.angle,
  };

  requireFinite('A position', next.x, next.y, next.z, next.angle);

  let moved = map;

  if (
    next.x !== object.x ||
    next.y !== object.y ||
    next.z !== object.z ||
    next.angle !== object.angle
  ) {
    moved = spliceMap(
      map,
      object.chunk.start,
      object.chunk.start + 16,
      f32s(next.x, next.y, next.z, next.angle),
    );
  }

  if (edit.template === undefined) {
    return moved;
  }

  const target = moved.objects[edit.index];

  return spliceMap(
    moved,
    target.templateSpan[0],
    target.templateSpan[1],
    mapString(templateName(edit.template)),
  );
};

/**
 * Applies an edit and returns the map read again. Throws, with a message for
 * the user, when the edit does not fit the map.
 */
export const applyMapEdit = (map: MapFile, edit: MapEdit): MapFile => {
  switch (edit.kind) {
    case 'timeOfDay': {
      if (!map.lighting) {
        throw new Error('This map has no lighting');
      }

      if (![1, 2, 3, 4].includes(edit.value)) {
        throw new Error('The time of day is 1 to 4');
      }

      return spliceMap(
        map,
        map.lighting.timeOfDayAt,
        map.lighting.timeOfDayAt + 4,
        u32(edit.value),
      );
    }
    case 'scriptActive': {
      const nodes = (list: MapScriptNode[]): MapScriptNode[] =>
        list.flatMap((node) => [
          node,
          ...(node.kind === 'group' ? nodes(node.children) : []),
        ]);

      if (
        !map.scripts
          .flat()
          .some((node) =>
            nodes([node]).some((candidate) => candidate.activeAt === edit.at),
          )
      ) {
        throw new Error('There is no script there');
      }

      return spliceMap(
        map,
        edit.at,
        edit.at + 1,
        Uint8Array.of(edit.active ? 1 : 0),
      );
    }
    case 'light': {
      if (!map.lighting || edit.config < 0 || edit.config > 3) {
        throw new Error('There is no such lighting');
      }

      if (!edit.value.every(Number.isFinite)) {
        throw new Error('A light holds three numbers');
      }

      // Each time of day is nine lights of nine floats; the terrain sun is the first
      const at =
        map.lighting.timeOfDayAt +
        4 +
        edit.config * 9 * 9 * 4 +
        { ambient: 0, color: 12, direction: 24 }[edit.field];

      return spliceMap(map, at, at + 12, f32s(...edit.value));
    }
    case 'dict': {
      const dict = ownerDict(map, edit.owner);

      if (!dict) {
        throw new Error('There is no such dictionary');
      }

      if (!dict.entries.some((candidate) => candidate.key === edit.key)) {
        throw new Error(`There is no ${edit.key} to change`);
      }

      return setProperty(map, { ...edit, kind: 'property' });
    }
    case 'property':
      return setProperty(map, edit);
    case 'object':
      return moveObject(map, edit);
    case 'objectAdd':
      return addObject(map, edit);
    case 'objectDelete':
      return deleteObject(map, edit.index);
    case 'waypointLink':
      return setLink(map, edit);
    case 'areaSet':
    case 'areaAdd':
    case 'areaDelete':
      return editArea(map, edit);
  }
};
