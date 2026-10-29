/**
 * W3D animations, ported from mint's `crates/sage/w3d/src/animation.rs`
 * (decoding) and `crates/sage/asset/src/pose.rs` (sampling):
 *
 * - `ANIMATION` (0x200): a header and dense channels, one value a frame
 * - `COMPRESSED_ANIMATION` (0x280): time-coded keys or adaptive deltas,
 *   chosen by the header's flavour, plus BFME's motion channels (0x284)
 *
 * A channel moves one bone along one axis, or rotates it, as a change from
 * its bind pose; visibility channels hide it. Everything is sampled here at
 * whole frames, so a player only interpolates between neighbours.
 */

import { createByteReader, type ByteReader } from '../../core/byteReader';

export type ChannelKind = 'x' | 'y' | 'z' | 'rotation' | 'visibility' | 'other';

/** A channel sampled at every frame; missing frames are `undefined` */
export interface SampledChannel {
  pivot: number;
  kind: ChannelKind;
  /** The channel type as stored (0-2 x y z, 6 a rotation), -1 for visibility */
  type: number;
  /** One value a frame, four for a rotation (x, y, z, w) */
  values: Float32Array;
  /** Frames with a value; others leave the bind pose alone */
  present: Uint8Array;
}

export interface W3dAnimation {
  name: string;
  hierarchyName: string;
  frameCount: number;
  frameRate: number;
  channels: SampledChannel[];
}

const CHUNK = {
  ANIMATION: 0x200,
  ANIMATION_HEADER: 0x201,
  ANIMATION_CHANNEL: 0x202,
  BIT_CHANNEL: 0x203,
  COMPRESSED_ANIMATION: 0x280,
  COMPRESSED_ANIMATION_HEADER: 0x281,
  COMPRESSED_ANIMATION_CHANNEL: 0x282,
  COMPRESSED_BIT_CHANNEL: 0x283,
  MOTION_CHANNEL: 0x284,
};

/** Frames refused past this, whatever a header claims */
const MAX_FRAMES = 100000;

const kindOf = (raw: number): ChannelKind =>
  raw === 0
    ? 'x'
    : raw === 1
      ? 'y'
      : raw === 2
        ? 'z'
        : raw === 6
          ? 'rotation'
          : 'other';

const widthOf = (kind: ChannelKind) => (kind === 'rotation' ? 4 : 1);

/** The adaptive-delta step table: powers of ten, then `1 - sin` steps */
const FILTER_TABLE = (() => {
  const table = new Float32Array(256);

  for (let index = 0; index < 16; index++) {
    table[index] = Number(`1e${index - 8}`);
  }

  for (let index = 0; index < 240; index++) {
    table[16 + index] = 1 - Math.sin(((90 * index) / 240) * (Math.PI / 180));
  }

  return table;
})();

const readFloats = (reader: ByteReader, count: number): number[] =>
  Array.from({ length: count }, () => reader.f32());

const readChunks = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: { type: number; payload: Uint8Array }[] = [];

  for (let at = 0; at + 8 <= bytes.length; ) {
    const type = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true) & 0x7fffffff;

    if (at + 8 + size > bytes.length) {
      throw new Error(`W3D chunk 0x${type.toString(16)} runs past its parent`);
    }

    chunks.push({ type, payload: bytes.subarray(at + 8, at + 8 + size) });
    at += 8 + size;
  }

  return chunks;
};

const readName = (bytes: Uint8Array, at: number) => {
  const raw = bytes.subarray(at, at + 16);
  const end = raw.indexOf(0);

  return String.fromCharCode(...(end < 0 ? raw : raw.subarray(0, end)));
};

/** Builds an empty sampled channel */
const channel = (
  pivot: number,
  kind: ChannelKind,
  frames: number,
  type = -1,
): SampledChannel => ({
  pivot,
  kind,
  type,
  values: new Float32Array(frames * widthOf(kind)),
  present: new Uint8Array(frames),
});

const set = (target: SampledChannel, frame: number, value: number[]) => {
  if (frame >= 0 && frame < target.present.length) {
    target.values.set(value, frame * value.length);
    target.present[frame] = 1;
  }
};

/** Normalised linear blend; close to a slerp over one frame's step */
const blend = (a: number[], b: number[], t: number): number[] => {
  if (a.length === 1) {
    return [a[0] + (b[0] - a[0]) * t];
  }

  const sign =
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const mixed = a.map((value, index) => value + (b[index] * sign - value) * t);
  const length = Math.hypot(...mixed) || 1;

  return mixed.map((value) => value / length);
};

/** Samples time-coded keys at every frame: held keys step, others blend */
const sampleKeys = (
  target: SampledChannel,
  keys: { frame: number; hold: boolean; value: number[] }[],
) => {
  if (!keys.length) {
    return;
  }

  keys.sort((a, b) => a.frame - b.frame);

  for (let frame = 0; frame < target.present.length; frame++) {
    let split = 0;

    while (split < keys.length && keys[split].frame <= frame) {
      split++;
    }

    if (split === 0) {
      set(target, frame, keys[0].value);
    } else if (split === keys.length) {
      set(target, frame, keys[keys.length - 1].value);
    } else {
      const earlier = keys[split - 1];
      const later = keys[split];
      const span = later.frame - earlier.frame;

      set(
        target,
        frame,
        later.hold || span <= 0
          ? earlier.value
          : blend(earlier.value, later.value, (frame - earlier.frame) / span),
      );
    }
  }
};

/** Rebuilds adaptive-delta values: frame 0 stored, then 16-frame blocks of deltas */
const readAdaptiveDelta = (
  reader: ByteReader,
  width: number,
  eightBit: boolean,
  count: number,
): number[][] => {
  const scale = reader.f32();
  const values = [readFloats(reader, width)];
  const blockBytes = eightBit ? 16 : 8;

  for (let block = 0; block * 16 + 1 < count; block++) {
    for (let component = 0; component < width; component++) {
      const step = FILTER_TABLE[reader.u8()] * scale * (eightBit ? 1 / 16 : 1);

      const deltas = reader.bytes(blockBytes);

      for (let index = 0; index < 16; index++) {
        const frame = block * 16 + index + 1;
        let delta: number;

        if (eightBit) {
          delta = deltas[index] - 128;
        } else {
          const byte = deltas[index >> 1];
          const nibble = index & 1 ? byte >> 4 : byte & 15;

          delta = nibble >= 8 ? nibble - 16 : nibble;
        }

        if (frame < count) {
          values[frame] ??= new Array(width).fill(0);
          values[frame][component] =
            values[frame - 1][component] + step * delta;
        }
      }
    }
  }

  return values;
};

/** Sets dense values, holding the last one to the end as the game does */
const holdLast = (target: SampledChannel, values: number[][]) => {
  for (let frame = 0; frame < target.present.length && values.length; frame++) {
    set(target, frame, values[Math.min(frame, values.length - 1)]);
  }
};

const readBits = (
  target: SampledChannel,
  first: number,
  last: number,
  fallback: boolean,
  packed: Uint8Array,
) => {
  for (let frame = 0; frame < target.present.length; frame++) {
    const index = frame - first;
    const visible =
      frame < first || frame > last
        ? fallback
        : ((packed[index >> 3] >> (index & 7)) & 1) === 1;

    set(target, frame, [visible ? 1 : 0]);
  }
};

const readChannel = (
  type: number,
  payload: Uint8Array,
  flavor: number,
  frames: number,
): SampledChannel | undefined => {
  const reader = createByteReader(payload, true, {
    describeOverrun: () => 'An animation channel ends early',
  });

  switch (type) {
    case CHUNK.ANIMATION_CHANNEL: {
      const first = reader.u16();
      const last = reader.u16();

      reader.u16();

      const type = reader.u16();
      const kind = kindOf(type);
      const pivot = reader.u16();

      reader.u16();

      const target = channel(pivot, kind, frames, type);

      for (let frame = first; frame <= last; frame++) {
        set(target, frame, readFloats(reader, widthOf(kind)));
      }

      return target;
    }
    case CHUNK.BIT_CHANNEL: {
      const first = reader.u16();
      const last = reader.u16();

      reader.u16();

      const pivot = reader.u16();
      const fallback = reader.u8() !== 0;
      const target = channel(pivot, 'visibility', frames);

      readBits(target, first, last, fallback, reader.bytes(Math.max(0, Math.ceil((last - first + 1) / 8))));

      return target;
    }
    case CHUNK.COMPRESSED_ANIMATION_CHANNEL: {
      const count = reader.u32();
      const pivot = reader.u16();

      reader.u8();

      const type = reader.u8();
      const kind = kindOf(type);
      const width = widthOf(kind);
      const target = channel(pivot, kind, frames, type);

      if (flavor === 1) {
        holdLast(
          target,
          readAdaptiveDelta(reader, width, false, Math.min(count, MAX_FRAMES)),
        );
      } else {
        const keys = [];

        for (let index = 0; index < Math.min(count, MAX_FRAMES); index++) {
          const raw = reader.u32();

          keys.push({
            frame: raw & 0x7fffffff,
            hold: raw >>> 31 === 1,
            value: readFloats(reader, width),
          });
        }

        sampleKeys(target, keys);
      }

      return target;
    }
    case CHUNK.COMPRESSED_BIT_CHANNEL: {
      const count = reader.u32();
      const pivot = reader.u16();

      reader.u8();

      const fallback = reader.u8() !== 0;
      const target = channel(pivot, 'visibility', frames);
      const keys: [number, boolean][] = [];

      for (let index = 0; index < Math.min(count, MAX_FRAMES); index++) {
        const raw = reader.u32();

        keys.push([raw & 0x7fffffff, raw >>> 31 === 1]);
      }

      keys.sort((a, b) => a[0] - b[0]);

      for (let frame = 0, key = -1; frame < frames; frame++) {
        while (key + 1 < keys.length && keys[key + 1][0] <= frame) {
          key++;
        }

        set(target, frame, [(key < 0 ? fallback : keys[key][1]) ? 1 : 0]);
      }

      return target;
    }
    case CHUNK.MOTION_CHANNEL: {
      reader.u8();

      const deltaType = reader.u8();

      reader.u8();

      const type = reader.u8();
      const kind = kindOf(type);
      const width = widthOf(kind);
      const count = reader.u16();
      const pivot = reader.u16();
      const target = channel(pivot, kind, frames, type);

      if (deltaType === 0) {
        const times = Array.from({ length: count }, () => reader.u16());

        if (count % 2) {
          reader.u16();
        }

        sampleKeys(
          target,
          times.map((raw) => ({
            frame: raw & 0x7fff,
            hold: raw >>> 15 === 1,
            value: readFloats(reader, width),
          })),
        );
      } else if (deltaType === 1 || deltaType === 2) {
        holdLast(
          target,
          readAdaptiveDelta(reader, width, deltaType === 2, count),
        );
      } else {
        throw new Error(`Motion channel of unknown delta type ${deltaType}`);
      }

      return target;
    }
  }

  return undefined;
};

/** Reads every animation in a W3D file */
export const parseW3dAnimations = (bytes: Uint8Array): W3dAnimation[] =>
  readChunks(bytes)
    .filter(
      (chunk) =>
        chunk.type === CHUNK.ANIMATION ||
        chunk.type === CHUNK.COMPRESSED_ANIMATION,
    )
    .flatMap((chunk) => {
      const children = readChunks(chunk.payload);
      const header = children.find(
        (child) =>
          child.type === CHUNK.ANIMATION_HEADER ||
          child.type === CHUNK.COMPRESSED_ANIMATION_HEADER,
      );

      if (!header || header.payload.length < 44) {
        return [];
      }

      const view = new DataView(
        header.payload.buffer,
        header.payload.byteOffset,
        header.payload.byteLength,
      );
      const isCompressed = chunk.type === CHUNK.COMPRESSED_ANIMATION;
      const frameCount = Math.min(view.getUint32(36, true), MAX_FRAMES);
      const frameRate = isCompressed
        ? view.getUint16(40, true)
        : view.getUint32(40, true);
      const flavor = isCompressed ? view.getUint16(42, true) : 0;
      const channels = children.flatMap((child) => {
        const sampled = readChannel(
          child.type,
          child.payload,
          flavor,
          frameCount,
        );

        return sampled ? [sampled] : [];
      });

      return [
        {
          name: readName(header.payload, 4),
          hierarchyName: readName(header.payload, 20),
          frameCount,
          frameRate: frameRate || 30,
          channels,
        },
      ];
    });

/**
 * The animation an INI line names, `SKELETON.CLIP`: the one whose skeleton
 * and name are those, else the one named `CLIP`, else the file's first
 */
export const findAnimation = (
  animations: W3dAnimation[],
  name: string,
): W3dAnimation | undefined => {
  const wanted = name.toLowerCase();
  const clip = wanted.slice(wanted.lastIndexOf('.') + 1);

  return (
    animations.find(
      (each) => `${each.hierarchyName}.${each.name}`.toLowerCase() === wanted,
    ) ??
    animations.find((each) => each.name.toLowerCase() === clip) ??
    animations[0]
  );
};
