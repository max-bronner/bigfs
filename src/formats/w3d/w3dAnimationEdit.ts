import { EASINGS } from '../core/expression';
import type { SampledChannel, W3dAnimation } from './w3dAnimation';

/**
 * Changing a W3D bone animation over its frames, the way the APT timeline
 * tools change a movie: retime it to another length, reverse it, run it
 * along an easing curve, keep a range, set its rate. Every operation works
 * on the sampled channels (one value a frame) and returns a new animation;
 * `writeW3dAnimation` stores one as the uncompressed `ANIMATION` (0x200)
 * chunk, which BFME reads and ships 1,354 of (mint's w3d-animation.md).
 */

/** The most frames a second a rate may ask for */
export const MAX_FRAME_RATE = 1000;

/**
 * Why a rate cannot be stored, if it cannot: the header holds a whole
 * number of frames a second, and a 0 reads back as the default 30
 */
export const frameRateProblem = (frameRate: number): string | undefined =>
  Number.isInteger(frameRate) && frameRate >= 1 && frameRate <= MAX_FRAME_RATE
    ? undefined
    : `A frame rate is a whole number from 1 to ${MAX_FRAME_RATE}, not ${frameRate}`;

/** The animation played at another rate, which must be a whole number a second */
export const rateAnimation = (
  animation: W3dAnimation,
  frameRate: number,
): W3dAnimation => {
  const problem = frameRateProblem(frameRate);

  if (problem) {
    throw new Error(problem);
  }
  return { ...animation, frameRate };
};

/** Where frame `j` of the result reads the source, as a fractional frame */
type TimeMap = (frame: number) => number;

const normalise = (q: number[]) => {
  const length = Math.hypot(...q) || 1;

  return q.map((value) => value / length);
};

/** One channel sampled at a fractional source frame */
const sample = (
  channel: SampledChannel,
  at: number,
): { value: number[]; present: boolean } => {
  const width = channel.kind === 'rotation' ? 4 : 1;
  const frames = channel.present.length;
  const low = Math.max(0, Math.min(frames - 1, Math.floor(at)));
  const high = Math.min(frames - 1, low + 1);
  const t = Math.max(0, Math.min(1, at - low));
  const a = Array.from(
    channel.values.subarray(low * width, low * width + width),
  );
  const b = Array.from(
    channel.values.subarray(high * width, high * width + width),
  );
  const present = !!channel.present[t < 0.5 ? low : high];

  if (
    channel.kind === 'visibility' ||
    !channel.present[low] ||
    !channel.present[high]
  ) {
    return { value: t < 0.5 ? a : b, present };
  }
  if (width === 4) {
    // The nearer of the two covers of b, then a normalised blend
    const sign =
      a.reduce((sum, value, axis) => sum + value * b[axis], 0) < 0 ? -1 : 1;

    return {
      value: normalise(
        a.map((value, axis) => value + (sign * b[axis] - value) * t),
      ),
      present,
    };
  }
  return { value: [a[0] + (b[0] - a[0]) * t], present };
};

const remap = (
  animation: W3dAnimation,
  frameCount: number,
  map: TimeMap,
): W3dAnimation => ({
  ...animation,
  frameCount,
  channels: animation.channels.map((channel) => {
    const width = channel.kind === 'rotation' ? 4 : 1;
    const values = new Float32Array(frameCount * width);
    const present = new Uint8Array(frameCount);

    for (let frame = 0; frame < frameCount; frame++) {
      const sampled = sample(channel, map(frame));

      values.set(sampled.value, frame * width);
      present[frame] = sampled.present ? 1 : 0;
    }
    return { ...channel, values, present };
  }),
});

const last = (animation: W3dAnimation) => Math.max(0, animation.frameCount - 1);

/** The same motion over `frames` frames, interpolated between the old ones */
export const retimeAnimation = (
  animation: W3dAnimation,
  frames: number,
): W3dAnimation => {
  if (!Number.isInteger(frames) || frames < 1) {
    throw new Error('An animation keeps at least one frame');
  }
  return remap(animation, frames, (frame) =>
    frames > 1 ? (frame * last(animation)) / (frames - 1) : 0,
  );
};

export const reverseAnimation = (animation: W3dAnimation): W3dAnimation =>
  remap(animation, animation.frameCount, (frame) => last(animation) - frame);

/** The same frames, played along an easing curve: slow in, slow out, … */
export const easeAnimation = (
  animation: W3dAnimation,
  easing: string,
): W3dAnimation => {
  const ease = EASINGS[easing];

  if (!ease) {
    throw new Error(`There is no easing called ${easing}`);
  }
  return remap(
    animation,
    animation.frameCount,
    (frame) =>
      ease(last(animation) ? frame / last(animation) : 0) * last(animation),
  );
};

/** Frames `from` to `to` only */
export const trimAnimation = (
  animation: W3dAnimation,
  from: number,
  to: number,
): W3dAnimation => {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to >= animation.frameCount ||
    from > to
  ) {
    throw new Error(
      `Frames ${from} to ${to} are not in its ${animation.frameCount}`,
    );
  }
  return remap(animation, to - from + 1, (frame) => from + frame);
};

/** W3D names hold 15 characters and a terminator */
export const MAX_NAME = 15;

const CHUNK = {
  ANIMATION: 0x200,
  ANIMATION_HEADER: 0x201,
  ANIMATION_CHANNEL: 0x202,
  BIT_CHANNEL: 0x203,
};

/** W3D version 4.1, which every uncompressed animation in BFME carries */
const VERSION = (4 << 16) | 1;

class Writer {
  private readonly parts: Uint8Array[] = [];
  private length = 0;

  public bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;

    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  private push(size: number, fill: (view: DataView) => void) {
    const part = new Uint8Array(size);

    fill(new DataView(part.buffer));
    this.parts.push(part);
    this.length += size;
  }

  public u8(value: number) {
    this.push(1, (view) => view.setUint8(0, value));
  }

  public u16(value: number) {
    this.push(2, (view) => view.setUint16(0, value, true));
  }

  public u32(value: number) {
    this.push(4, (view) => view.setUint32(0, value >>> 0, true));
  }

  public f32(value: number) {
    this.push(4, (view) => view.setFloat32(0, value, true));
  }

  public name(text: string) {
    const part = new Uint8Array(16);

    for (let index = 0; index < Math.min(text.length, MAX_NAME); index++) {
      part[index] = text.charCodeAt(index) & 0x7f;
    }
    this.parts.push(part);
    this.length += 16;
  }

  public raw(part: Uint8Array) {
    this.parts.push(part);
    this.length += part.length;
  }
}

const chunk = (type: number, payload: Uint8Array, container = false) => {
  const writer = new Writer();

  writer.u32(type);
  writer.u32((payload.length | (container ? 0x80000000 : 0)) >>> 0);
  writer.raw(payload);
  return writer.bytes();
};

/** The frames a channel sets, first to last; frames between it held from the one before */
const rangeOf = (channel: SampledChannel) => {
  const first = channel.present.indexOf(1);

  return first < 0
    ? undefined
    : { first, last: channel.present.lastIndexOf(1) };
};

const channelChunk = (channel: SampledChannel): Uint8Array | undefined => {
  const range = rangeOf(channel);

  if (!range) {
    return undefined;
  }

  const writer = new Writer();

  if (channel.kind === 'visibility') {
    const count = range.last - range.first + 1;
    const bits = new Uint8Array(Math.ceil(count / 8));

    for (let index = 0; index < count; index++) {
      if (channel.values[range.first + index]) {
        bits[index >> 3] |= 1 << (index & 7);
      }
    }
    writer.u16(range.first);
    writer.u16(range.last);
    writer.u16(0);
    writer.u16(channel.pivot);
    writer.u8(1);
    writer.raw(bits);
    return chunk(CHUNK.BIT_CHANNEL, writer.bytes());
  }

  const width = channel.kind === 'rotation' ? 4 : 1;
  let held = range.first;

  writer.u16(range.first);
  writer.u16(range.last);
  writer.u16(width);
  writer.u16(channel.type);
  writer.u16(channel.pivot);
  writer.u16(0);
  for (let frame = range.first; frame <= range.last; frame++) {
    if (channel.present[frame]) {
      held = frame;
    }
    for (let axis = 0; axis < width; axis++) {
      writer.f32(channel.values[held * width + axis]);
    }
  }
  return chunk(CHUNK.ANIMATION_CHANNEL, writer.bytes());
};

/** A W3D file holding one uncompressed animation */
export const writeW3dAnimation = (animation: W3dAnimation): Uint8Array => {
  if (
    animation.name.length > MAX_NAME ||
    animation.hierarchyName.length > MAX_NAME
  ) {
    throw new Error(`W3D names hold at most ${MAX_NAME} characters`);
  }

  const header = new Writer();

  header.u32(VERSION);
  header.name(animation.name);
  header.name(animation.hierarchyName);
  header.u32(animation.frameCount);
  if (!Number.isInteger(animation.frameRate) || animation.frameRate < 1) {
    throw new Error(frameRateProblem(animation.frameRate));
  }
  header.u32(animation.frameRate);

  const body = new Writer();

  body.raw(chunk(CHUNK.ANIMATION_HEADER, header.bytes()));
  for (const channel of animation.channels) {
    const written = channelChunk(channel);

    if (written) {
      body.raw(written);
    }
  }
  return chunk(CHUNK.ANIMATION, body.bytes(), true);
};
