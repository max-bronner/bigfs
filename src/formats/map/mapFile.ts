import { compressEar, decompressEar, isEarWrapped } from '../refpack';
import { decodeWindows1252 } from '../../common/windows1252';

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
  chunks: MapChunk[];
  worldInfo?: Dict;
  heights?: MapHeights;
  lighting?: MapLighting;
  objects: MapObject[];
  sides: Dict[];
  problems: string[];
}

/** Chunks whose payload is a list of child chunks */
const CONTAINERS = new Set(['ObjectsList']);

const latin1 = { decode: decodeWindows1252 };

class MapReader {
  public readonly view: DataView;

  public constructor(
    public readonly bytes: Uint8Array,
    public at = 0,
    public end = bytes.length,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  public need(count: number): void {
    if (count < 0 || this.at + count > this.end) {
      throw new Error(`Map data ends early at ${this.at}`);
    }
  }

  public u8(): number {
    this.need(1);

    return this.bytes[this.at++];
  }

  public u16(): number {
    this.need(2);
    this.at += 2;

    return this.view.getUint16(this.at - 2, true);
  }

  public u32(): number {
    this.need(4);
    this.at += 4;

    return this.view.getUint32(this.at - 4, true);
  }

  public i32(): number {
    return this.u32() | 0;
  }

  public f32(): number {
    this.need(4);
    this.at += 4;

    return this.view.getFloat32(this.at - 4, true);
  }

  public string(): string {
    const length = this.u16();

    this.need(length);
    this.at += length;

    return latin1.decode(this.bytes.subarray(this.at - length, this.at));
  }

  public wide(): string {
    const length = this.u16();

    this.need(length * 2);

    let text = '';

    for (let index = 0; index < length; index++) {
      text += String.fromCharCode(
        this.view.getUint16(this.at + index * 2, true),
      );
    }

    this.at += length * 2;

    return text;
  }
}

const readChunks = (
  reader: MapReader,
  names: Map<number, string>,
  end: number,
  depth: number,
): MapChunk[] => {
  const chunks: MapChunk[] = [];

  while (reader.at < end) {
    const header = reader.at;
    const index = reader.u32();
    const version = reader.u16();
    const length = reader.u32();
    const start = reader.at;

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

    if (CONTAINERS.has(name) && depth < 4) {
      chunk.children = readChunks(
        new MapReader(reader.bytes, start, start + length),
        names,
        start + length,
        depth + 1,
      );
    }

    reader.at = start + length;
    chunks.push(chunk);
  }

  return chunks;
};

const readDict = (reader: MapReader, names: Map<number, string>): Dict => {
  const start = reader.at;
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
        value = { type: 'string', value: reader.string() };
        break;
      case 4:
        value = { type: 'wide', value: reader.wide() };
        break;
      default:
        throw new Error(
          `Dictionary value of unknown type ${word & 255} at ${reader.at - 4}`,
        );
    }

    entries.push({ key, keyIndex, value });
  }

  return { start, end: reader.at, entries };
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
        if (/[^\x00-\xff]/.test(value.value) || value.value.length > 0xffff) {
          throw new Error('A map string holds up to 65,535 Latin-1 characters');
        }
        u16(value.value.length);
        out.push(...Array.from(value.value, (char) => char.charCodeAt(0)));
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

const find = (chunks: MapChunk[], name: string) =>
  chunks.find((chunk) => chunk.name === name);

/** Reads a map body (decompressed) */
export const parseMapBody = (
  body: Uint8Array,
  compression: MapFile['compression'],
): MapFile => {
  if (latin1.decode(body.subarray(0, 4)) !== 'CkMp') {
    throw new Error('Not a map: the body does not start with CkMp');
  }

  const reader = new MapReader(body, 4);
  const names = new Map<number, string>();

  for (let count = reader.u32(); count > 0; count--) {
    const length = reader.u8();

    reader.need(length);

    const name = latin1.decode(body.subarray(reader.at, reader.at + length));

    reader.at += length;
    names.set(reader.u32(), name);
  }

  const chunks = readChunks(reader, names, body.length, 0);
  const map: MapFile = {
    compression,
    body,
    names,
    chunks,
    objects: [],
    sides: [],
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
    new MapReader(body, chunk.start, chunk.end);

  const worldInfo = find(chunks, 'WorldInfo');

  if (worldInfo) {
    attempt('WorldInfo', () => {
      map.worldInfo = readDict(payload(worldInfo), names);
    });
  }

  const heightMap = find(chunks, 'HeightMapData');

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

      data.need(count * sampleBytes);

      if (count !== width * height) {
        throw new Error(`${count} samples for ${width}×${height} cells`);
      }

      const samples = new Uint16Array(count);

      for (let index = 0; index < count; index++) {
        samples[index] =
          sampleBytes === 2
            ? data.view.getUint16(data.at + index * 2, true)
            : body[data.at + index];
      }

      map.heights = { width, height, border, boundaries, samples, sampleBytes };
    });
  }

  const lighting = find(chunks, 'GlobalLighting');

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

  const objects = find(chunks, 'ObjectsList');

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
      const templateStart = data.at;
      const template = data.string();
      const templateSpan: [number, number] = [templateStart, data.at];

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

  const sides = find(chunks, 'SidesList');

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
          data.string();
          data.string();
          data.need(4 * 4 + 1 + 4);
          data.at += 4 * 4 + 1 + 4;
          if (sides.version >= 3) {
            data.string();
          }
          data.need(4 + 3);
          data.at += 4 + 3;
        }
      }
    });
  }

  return map;
};

/** Reads a `.map` or `.bse` file, compressed or not */
export const parseMap = (bytes: Uint8Array): MapFile =>
  isEarWrapped(bytes)
    ? parseMapBody(decompressEar(bytes), 'ear')
    : parseMapBody(bytes, 'none');

/** The file bytes of a map, compressed the way it was read */
export const writeMap = (map: MapFile): Uint8Array =>
  map.compression === 'ear' ? compressEar(map.body) : map.body;

/** Every chunk, nested ones included */
const allChunks = (chunks: MapChunk[]): MapChunk[] =>
  chunks.flatMap((chunk) => [chunk, ...allChunks(chunk.children ?? [])]);

/**
 * Replaces `[start, end)` of the body, growing or shrinking every chunk
 * that holds the span, and returns the map read again
 */
export const spliceMap = (
  map: MapFile,
  start: number,
  end: number,
  replacement: Uint8Array,
): MapFile => {
  const delta = replacement.length - (end - start);
  const body = new Uint8Array(map.body.length + delta);

  body.set(map.body.subarray(0, start));
  body.set(replacement, start);
  body.set(map.body.subarray(end), start + replacement.length);

  const view = new DataView(body.buffer);

  for (const chunk of allChunks(map.chunks)) {
    if (chunk.start <= start && end <= chunk.end) {
      const lengthAt = chunk.header + 6;

      view.setUint32(lengthAt, chunk.end - chunk.start + delta, true);
    }
  }

  return parseMapBody(body, map.compression);
};

/** An edit the map editor makes */
export type MapEdit =
  | { kind: 'timeOfDay'; value: number }
  | {
      kind: 'dict';
      owner: 'world' | { side: number } | { object: number };
      key: string;
      value: DictValue;
    }
  | {
      kind: 'object';
      index: number;
      x?: number;
      y?: number;
      z?: number;
      angle?: number;
      template?: string;
    };

const ownerDict = (
  map: MapFile,
  owner: Extract<MapEdit, { kind: 'dict' }>['owner'],
): Dict | undefined =>
  owner === 'world'
    ? map.worldInfo
    : 'side' in owner
      ? map.sides[owner.side]
      : map.objects[owner.object]?.properties;

/** Applies an edit and returns the map read again */
export const applyMapEdit = (map: MapFile, edit: MapEdit): MapFile => {
  switch (edit.kind) {
    case 'timeOfDay': {
      if (!map.lighting) {
        throw new Error('This map has no lighting');
      }

      if (![1, 2, 3, 4].includes(edit.value)) {
        throw new Error('The time of day is 1 to 4');
      }

      const word = new Uint8Array(4);

      new DataView(word.buffer).setUint32(0, edit.value, true);

      return spliceMap(
        map,
        map.lighting.timeOfDayAt,
        map.lighting.timeOfDayAt + 4,
        word,
      );
    }
    case 'dict': {
      const dict = ownerDict(map, edit.owner);

      if (!dict) {
        throw new Error('There is no such dictionary');
      }

      const entry = dict.entries.find(
        (candidate) => candidate.key === edit.key,
      );

      if (!entry) {
        throw new Error(`There is no ${edit.key} to change`);
      }

      if (entry.value.type !== edit.value.type) {
        throw new Error(
          `${edit.key} holds a ${entry.value.type}, not a ${edit.value.type}`,
        );
      }

      const entries = dict.entries.map((candidate) =>
        candidate === entry ? { ...entry, value: edit.value } : candidate,
      );

      return spliceMap(map, dict.start, dict.end, writeDict(entries));
    }
    case 'object': {
      const object = map.objects[edit.index];

      if (!object) {
        throw new Error('There is no such object');
      }

      let next = map;
      const fields: ['x' | 'y' | 'z' | 'angle', number][] = [
        ['x', 0],
        ['y', 4],
        ['z', 8],
        ['angle', 12],
      ];

      for (const [field, offset] of fields) {
        const value = edit[field];

        if (value !== undefined) {
          if (!Number.isFinite(value)) {
            throw new Error(`${field} must be a number`);
          }

          const word = new Uint8Array(new Float32Array([value]).buffer);

          next = spliceMap(
            next,
            object.chunk.start + offset,
            object.chunk.start + offset + 4,
            word,
          );
        }
      }

      if (edit.template !== undefined) {
        const template = edit.template.trim();

        if (!template || /[^\x20-\x7e]/.test(template)) {
          throw new Error('A template name is plain ASCII');
        }

        const target = next.objects[edit.index];
        const bytes = new Uint8Array(2 + template.length);

        new DataView(bytes.buffer).setUint16(0, template.length, true);
        bytes.set(
          Array.from(template, (char) => char.charCodeAt(0)),
          2,
        );
        next = spliceMap(
          next,
          target.templateSpan[0],
          target.templateSpan[1],
          bytes,
        );
      }

      return next;
    }
  }
};
