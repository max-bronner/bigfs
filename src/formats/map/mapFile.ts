import { compressEar, decompressEar, isEarWrapped } from '../refpack/refpack';
import { decodeWindows1252, encodeWindows1252 } from '../../core/windows1252';
import { createByteReader, type ByteReader } from '../../core/byteReader';

/**
 * SAGE `.map` and `.bse` files, ported from mint's `crates/sage/map` and
 * `docs/research/map-format.md`:
 *
 * ```
 * "EAR\0" u32 size, RefPack stream       (optional wrapper)
 * "CkMp" u32 N, N x { u8 length, name, u32 index }
 * chunks: u32 name index, u16 version, u32 length, payload
 * ```
 *
 * A chunk's payload may hold child chunks; which ones do is known by name.
 * Strings are `u16` length then bytes; a dictionary is `u16` count then
 * `u32` (type in the low byte, name index above) and a value.
 *
 * Edits splice the decompressed body and adjust the length of every chunk
 * around the splice, so everything else stays as read.
 */

export interface MapChunk {
  name: string;
  version: number;
  /** Offset of the chunk header in the body */
  header: number;
  start: number;
  end: number;
  children?: MapChunk[];
}

export type DictValue =
  | { type: 'bool'; value: boolean }
  | { type: 'int'; value: number }
  | { type: 'real'; value: number }
  | { type: 'string'; value: string }
  | { type: 'wide'; value: string };

export interface DictEntry {
  key: string;
  /** The name index the key is stored as */
  keyIndex: number;
  value: DictValue;
}

/** A dictionary and where it sits, so it can be written back */
export interface Dict {
  start: number;
  end: number;
  entries: DictEntry[];
}

export interface MapObject {
  /** Index among the objects, which an edit names */
  index: number;
  chunk: MapChunk;
  x: number;
  y: number;
  z: number;
  angle: number;
  flags: number;
  template: string;
  /** Span of the template name string */
  templateSpan: [number, number];
  properties: Dict;
}

export interface MapLight {
  ambient: number[];
  color: number[];
  direction: number[];
}

export interface MapLighting {
  /** 1 morning, 2 afternoon, 3 evening, 4 night */
  timeOfDay: number;
  /** Where the time of day is stored */
  timeOfDayAt: number;
  /** Per time of day, the terrain sun (light 0 of 9) */
  terrainSuns: MapLight[];
}

export interface MapHeights {
  width: number;
  height: number;
  border: number;
  boundaries: [number, number][];
  /** One sample per cell, row-major */
  samples: Uint16Array;
  /** One byte per sample before version 5 */
  sampleBytes: 1 | 2;
}

export interface MapFile {
  compression: 'ear' | 'none';
  body: Uint8Array;
  names: Map<number, string>;
  /** Where the name table ends in the body, which is where a new name goes */
  namesEnd: number;
  chunks: MapChunk[];
  worldInfo?: Dict;
  heights?: MapHeights;
  lighting?: MapLighting;
  objects: MapObject[];
  sides: Dict[];
  teams: Dict[];
  /** One list per player slot */
  scripts: MapScriptNode[][];
  triggerAreas: MapTriggerArea[];
  /** Where the `TriggerAreas` records sit in the body, if the chunk is there and read */
  triggerAreaSpan?: [number, number];
  waypointLinks: MapWaypointLink[];
  /** The `WaypointsList` chunk, if it is there and read whole */
  waypointLinksChunk?: MapChunk;
  problems: string[];
}

/** A directed link between two waypoint ids */
export interface MapWaypointLink {
  from: number;
  to: number;
}

/** A named polygon scripts refer to, in world units */
export interface MapTriggerArea {
  name: string;
  /** The editor layer the area was authored on; empty in shipped maps */
  layerName: string;
  id: number;
  points: [number, number][];
  /** The word after the points, kept as read */
  trailing: number;
}

/** A script call: a condition or an action, by its name and parameters */
export interface MapScriptCall {
  name: string;
  parameters: string[];
}

export type MapScriptNode =
  | {
      kind: 'group';
      name: string;
      active: boolean;
      /** Where the active flag byte is */
      activeAt: number;
      subroutine: boolean;
      children: MapScriptNode[];
    }
  | {
      kind: 'script';
      name: string;
      comment: string;
      active: boolean;
      activeAt: number;
      oneShot: boolean;
      difficulties: string[];
      subroutine: boolean;
      /** OR of AND groups */
      conditions: MapScriptCall[][];
      actions: MapScriptCall[];
      actionsFalse: MapScriptCall[];
    };

/** Chunks whose payload is a list of child chunks */
const CONTAINERS = new Set([
  'ObjectsList',
  'PlayerScriptsList',
  'ScriptList',
  'OrCondition',
]);

/** Script chunks: fields first, then child chunks */
const PREFIXED = new Set(['ScriptGroup', 'Script']);

const latin1 = { decode: decodeWindows1252 };

/** Reads a window of the body, failing with the map's own message when a read runs past it */
const createMapReader = (
  bytes: Uint8Array,
  start = 0,
  end = bytes.length,
): ByteReader =>
  createByteReader(bytes, true, {
    start,
    end,
    describeOverrun: (offset) => `Map data ends early at ${offset}`,
  });

/** Reads a string with a 16-bit byte length */
const readString = (reader: ByteReader): string =>
  latin1.decode(reader.bytes(reader.u16()));

/** Reads a UTF-16 string with a 16-bit character count */
const readWide = (reader: ByteReader): string => {
  const raw = reader.bytes(reader.u16() * 2);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let text = '';

  for (let index = 0; index < raw.length; index += 2) {
    text += String.fromCharCode(view.getUint16(index, true));
  }

  return text;
};

/** Skips a script or group's own fields, leaving the reader at its children */
const skipScriptFields = (reader: ByteReader, name: string, version: number) => {
  readString(reader);

  if (name === 'ScriptGroup') {
    reader.u8();
    reader.u8();

    return;
  }

  readString(reader);
  readString(reader);
  readString(reader);
  reader.skip(6 + 4);

  if (version >= 3) {
    reader.skip(2 + 4 + 1);
    readString(reader);

    if (version >= 4) {
      readString(reader);
    }
  }
};

const readChunks = (
  body: Uint8Array,
  reader: ByteReader,
  names: Map<number, string>,
  end: number,
  depth: number,
): MapChunk[] => {
  const chunks: MapChunk[] = [];

  while (reader.offset < end) {
    const header = reader.offset;
    const index = reader.u32();
    const version = reader.u16();
    const length = reader.u32();
    const start = reader.offset;

    if (length > end - start) {
      throw new Error(
        `Chunk at ${header} claims ${length} bytes, past its parent`,
      );
    }

    const name = names.get(index) ?? `#${index}`;
    const chunk: MapChunk = {
      name,
      version,
      header,
      start,
      end: start + length,
    };

    // A child walk that fails leaves the chunk a leaf; the rest still reads
    try {
      if (CONTAINERS.has(name) && depth < 64) {
        chunk.children = readChunks(
          body,
          createMapReader(body, start, start + length),
          names,
          start + length,
          depth + 1,
        );
      } else if (PREFIXED.has(name) && depth < 64) {
        const fields = createMapReader(body, start, start + length);

        skipScriptFields(fields, name, version);
        chunk.children = readChunks(body, fields, names, start + length, depth + 1);
      }
    } catch {
      chunk.children = undefined;
    }

    reader.seek(start + length);
    chunks.push(chunk);
  }

  return chunks;
};

const readDict = (reader: ByteReader, names: Map<number, string>): Dict => {
  const start = reader.offset;
  const count = reader.u16();
  const entries: DictEntry[] = [];

  for (let index = 0; index < count; index++) {
    const word = reader.u32();
    const keyIndex = word >>> 8;
    const key = names.get(keyIndex) ?? `#${keyIndex}`;
    let value: DictValue;

    switch (word & 255) {
      case 0:
        value = { type: 'bool', value: reader.u8() !== 0 };
        break;
      case 1:
        value = { type: 'int', value: reader.i32() };
        break;
      case 2:
        value = { type: 'real', value: reader.f32() };
        break;
      case 3:
        value = { type: 'string', value: readString(reader) };
        break;
      case 4:
        value = { type: 'wide', value: readWide(reader) };
        break;
      default:
        throw new Error(
          `Dictionary value of unknown type ${word & 255} at ${reader.offset - 4}`,
        );
    }

    entries.push({ key, keyIndex, value });
  }

  return { start, end: reader.offset, entries };
};

/** Serialises a dictionary in the form `readDict` reads */
export const writeDict = (entries: DictEntry[]): Uint8Array => {
  const out: number[] = [];
  const u16 = (value: number) => out.push(value & 255, (value >>> 8) & 255);
  const u32 = (value: number) =>
    out.push(
      value & 255,
      (value >>> 8) & 255,
      (value >>> 16) & 255,
      (value >>> 24) & 255,
    );
  const types = { bool: 0, int: 1, real: 2, string: 3, wide: 4 };

  u16(entries.length);

  for (const { keyIndex, value } of entries) {
    u32((keyIndex << 8) | types[value.type]);

    switch (value.type) {
      case 'bool':
        out.push(value.value ? 1 : 0);
        break;
      case 'int':
        u32(value.value | 0);
        break;
      case 'real':
        out.push(...new Uint8Array(new Float32Array([value.value]).buffer));
        break;
      case 'string':
        {
          // Read as Windows-1252, so a curly quote is one byte, U+0080 none
          const bytes = encodeWindows1252(value.value);

          if (bytes.length > 0xffff) {
            throw new Error(
              'A map string holds up to 65,535 Windows-1252 characters',
            );
          }
          u16(bytes.length);
          out.push(...bytes);
        }
        break;
      case 'wide':
        if (value.value.length > 0xffff) {
          throw new Error('A map string holds up to 65,535 characters');
        }
        u16(value.value.length);
        for (let index = 0; index < value.value.length; index++) {
          u16(value.value.charCodeAt(index));
        }
        break;
    }
  }

  return Uint8Array.from(out);
};

export const findChunk = (chunks: MapChunk[], name: string) =>
  chunks.find((chunk) => chunk.name === name);

/** Reads a map body (decompressed) */
export const parseMapBody = (
  body: Uint8Array,
  compression: MapFile['compression'],
): MapFile => {
  if (latin1.decode(body.subarray(0, 4)) !== 'CkMp') {
    throw new Error('Not a map: the body does not start with CkMp');
  }

  const reader = createMapReader(body, 4);
  const names = new Map<number, string>();

  for (let count = reader.u32(); count > 0; count--) {
    const length = reader.u8();

    const name = latin1.decode(reader.bytes(length));

    names.set(reader.u32(), name);
  }

  const namesEnd = reader.offset;
  const chunks = readChunks(body, reader, names, body.length, 0);
  const map: MapFile = {
    compression,
    body,
    names,
    namesEnd,
    chunks,
    objects: [],
    sides: [],
    teams: [],
    scripts: [],
    triggerAreas: [],
    waypointLinks: [],
    problems: [],
  };
  const attempt = (what: string, read: () => void) => {
    try {
      read();
    } catch (error) {
      map.problems.push(
        `${what}: ${error instanceof Error ? error.message : error}`,
      );
    }
  };
  const payload = (chunk: MapChunk) =>
    createMapReader(body, chunk.start, chunk.end);

  const worldInfo = findChunk(chunks, 'WorldInfo');

  if (worldInfo) {
    attempt('WorldInfo', () => {
      map.worldInfo = readDict(payload(worldInfo), names);
    });
  }

  const heightMap = findChunk(chunks, 'HeightMapData');

  if (heightMap) {
    attempt('HeightMapData', () => {
      const data = payload(heightMap);
      const width = data.u32();
      const height = data.u32();
      const border = data.u32();
      const boundaries: [number, number][] = [];

      for (let count = data.u32(); count > 0; count--) {
        boundaries.push([data.i32(), data.i32()]);
      }

      const count = data.u32();
      const sampleBytes = heightMap.version >= 5 ? 2 : 1;

      const raw = data.bytes(count * sampleBytes);

      if (count !== width * height) {
        throw new Error(`${count} samples for ${width}×${height} cells`);
      }

      const rawView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const samples = new Uint16Array(count);

      for (let index = 0; index < count; index++) {
        samples[index] =
          sampleBytes === 2
            ? rawView.getUint16(index * 2, true)
            : raw[index];
      }

      map.heights = { width, height, border, boundaries, samples, sampleBytes };
    });
  }

  const lighting = findChunk(chunks, 'GlobalLighting');

  if (lighting) {
    attempt('GlobalLighting', () => {
      const data = payload(lighting);
      const timeOfDay = data.u32();
      const terrainSuns: MapLight[] = [];

      for (let config = 0; config < 4; config++) {
        for (let light = 0; light < 9; light++) {
          const values = Array.from({ length: 9 }, () => data.f32());

          if (light === 0) {
            terrainSuns.push({
              ambient: values.slice(0, 3),
              color: values.slice(3, 6),
              direction: values.slice(6, 9),
            });
          }
        }
      }

      map.lighting = { timeOfDay, timeOfDayAt: lighting.start, terrainSuns };
    });
  }

  const objects = findChunk(chunks, 'ObjectsList');

  attempt('ObjectsList', () => {
    for (const chunk of objects?.children ?? []) {
      if (chunk.name !== 'Object') {
        continue;
      }

      const data = payload(chunk);
      const x = data.f32();
      const y = data.f32();
      const z = data.f32();
      const angle = data.f32();
      const flags = data.i32();
      const templateStart = data.offset;
      const template = readString(data);
      const templateSpan: [number, number] = [templateStart, data.offset];

      map.objects.push({
        index: map.objects.length,
        chunk,
        x,
        y,
        z,
        angle,
        flags,
        template,
        templateSpan,
        properties: readDict(data, names),
      });
    }
  });

  const sides = findChunk(chunks, 'SidesList');

  if (sides) {
    attempt('SidesList', () => {
      const data = payload(sides);

      if (sides.version >= 6) {
        data.u8();
      }

      for (let count = data.u32(); count > 0; count--) {
        map.sides.push(readDict(data, names));

        // A side's build list follows its dictionary
        for (let entries = data.u32(); entries > 0; entries--) {
          readString(data);
          readString(data);
          data.skip(4 * 4 + 1 + 4);
          if (sides.version >= 3) {
            readString(data);
          }
          data.skip(4 + 3);
        }
      }
    });
  }

  const teams = findChunk(chunks, 'Teams');

  if (teams) {
    attempt('Teams', () => {
      const data = payload(teams);

      for (let count = data.u32(); count > 0; count--) {
        map.teams.push(readDict(data, names));
      }
    });
  }

  const areas = findChunk(chunks, 'TriggerAreas');

  if (areas) {
    attempt('TriggerAreas', () => {
      const data = payload(areas);
      const found: MapTriggerArea[] = [];

      for (let count = data.u32(); count > 0; count--) {
        const name = readString(data);
        const layerName = readString(data);
        const id = data.u32();
        const points: [number, number][] = [];

        for (let point = data.u32(); point > 0; point--) {
          points.push([data.f32(), data.f32()]);
        }

        found.push({ name, layerName, id, points, trailing: data.u32() });
      }

      map.triggerAreas = found;
      map.triggerAreaSpan = [areas.start, data.offset];
    });
  }

  const links = findChunk(chunks, 'WaypointsList');

  if (links) {
    attempt('WaypointsList', () => {
      const data = payload(links);
      const count = data.u32();

      // A count the payload cannot hold is a chunk this editor leaves alone
      if (count * 8 !== links.end - links.start - 4) {
        throw new Error(`${count} links do not fill the chunk`);
      }

      for (let link = 0; link < count; link++) {
        map.waypointLinks.push({ from: data.i32(), to: data.i32() });
      }

      map.waypointLinksChunk = links;
    });
  }

  const scripts = findChunk(chunks, 'PlayerScriptsList');

  if (scripts) {
    attempt('PlayerScriptsList', () => {
      map.scripts = (scripts.children ?? []).map((list) =>
        readScriptNodes(list.children ?? [], body, names),
      );
    });
  }

  return map;
};

const readCall = (
  chunk: MapChunk,
  body: Uint8Array,
  names: Map<number, string>,
): MapScriptCall => {
  const data = createMapReader(body, chunk.start, chunk.end);

  data.u32();

  const key = data.u32();
  const parameters: string[] = [];

  for (let count = data.u32() | 0; count > 0; count--) {
    const type = data.u32() | 0;

    if (type === 16) {
      parameters.push(
        `(${[data.f32(), data.f32(), data.f32()].map((value) => Math.round(value * 10) / 10).join(', ')})`,
      );
    } else {
      const int = data.i32();
      const real = data.f32();
      const text = readString(data);

      parameters.push(
        text || (real ? String(Math.round(real * 1000) / 1000) : String(int)),
      );
    }
  }

  return { name: names.get(key >>> 8) ?? `#${key >>> 8}`, parameters };
};

const readScriptNodes = (
  chunks: MapChunk[],
  body: Uint8Array,
  names: Map<number, string>,
): MapScriptNode[] =>
  chunks.flatMap((chunk): MapScriptNode[] => {
    const data = createMapReader(body, chunk.start, chunk.end);

    if (chunk.name === 'ScriptGroup') {
      const name = readString(data);
      const activeAt = data.offset;
      const active = data.u8() !== 0;
      const subroutine = data.u8() !== 0;

      return [
        {
          kind: 'group',
          name,
          active,
          activeAt,
          subroutine,
          children: readScriptNodes(chunk.children ?? [], body, names),
        },
      ];
    }

    if (chunk.name !== 'Script') {
      return [];
    }

    const name = readString(data);
    const comment = readString(data);

    readString(data);
    readString(data);

    const activeAt = data.offset;
    const [active, oneShot, easy, normal, hard, subroutine] = [
      0, 1, 2, 3, 4, 5,
    ].map(() => data.u8() !== 0);
    const children = chunk.children ?? [];

    return [
      {
        kind: 'script',
        name,
        comment,
        active,
        activeAt,
        oneShot,
        difficulties: [
          easy && 'easy',
          normal && 'normal',
          hard && 'hard',
        ].filter((value): value is string => Boolean(value)),
        subroutine,
        conditions: children
          .filter((child) => child.name === 'OrCondition')
          .map((or) =>
            (or.children ?? [])
              .filter((child) => child.name === 'Condition')
              .map((child) => readCall(child, body, names)),
          ),
        actions: children
          .filter((child) => child.name === 'ScriptAction')
          .map((child) => readCall(child, body, names)),
        actionsFalse: children
          .filter((child) => child.name === 'ScriptActionFalse')
          .map((child) => readCall(child, body, names)),
      },
    ];
  });

/** Reads a `.map` or `.bse` file, compressed or not */
export const parseMap = (bytes: Uint8Array): MapFile =>
  isEarWrapped(bytes)
    ? parseMapBody(decompressEar(bytes), 'ear')
    : parseMapBody(bytes, 'none');

/** The file bytes of a map, compressed the way it was read */
export const writeMap = (map: MapFile): Uint8Array =>
  map.compression === 'ear' ? compressEar(map.body) : map.body;

/** Every chunk, nested ones included */
export const allChunks = (chunks: MapChunk[]): MapChunk[] =>
  chunks.flatMap((chunk) => [chunk, ...allChunks(chunk.children ?? [])]);

/**
 * Replaces `[start, end)` of the body, growing or shrinking every chunk
 * that holds the span, and returns the map read again. A span added at the
 * end of a chunk names that chunk as `inside`.
 */
export const spliceMap = (
  map: MapFile,
  start: number,
  end: number,
  replacement: Uint8Array,
  inside?: { start: number; end: number },
): MapFile => {
  const delta = replacement.length - (end - start);
  const body = new Uint8Array(map.body.length + delta);

  body.set(map.body.subarray(0, start));
  body.set(replacement, start);
  body.set(map.body.subarray(end), start + replacement.length);

  const view = new DataView(body.buffer);

  // Text added at the end of a chunk is inside it, which the span alone cannot say
  const holder = inside ?? { start, end };

  for (const chunk of allChunks(map.chunks)) {
    if (chunk.start <= holder.start && holder.end <= chunk.end) {
      const lengthAt = chunk.header + 6;

      view.setUint32(lengthAt, chunk.end - chunk.start + delta, true);
    }
  }

  return parseMapBody(body, map.compression);
};
