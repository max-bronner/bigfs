import type { AnimatedCursor } from './cursorFrame';
import { writeCur } from './writeCur';

const textBytes = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

/** Builds a RIFF chunk, padded to an even length */
const chunk = (id: string, body: Uint8Array): Uint8Array => {
  const out = new Uint8Array(8 + body.length + (body.length & 1));

  out.set(textBytes(id));
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);

  return out;
};

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
};

const uint32s = (values: number[]): Uint8Array => {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);

  values.forEach((value, index) => view.setUint32(index * 4, value, true));

  return out;
};

/**
 * Writes an animated cursor: the `anih` header, the `rate` and `seq ` chunks
 * and a `fram` list with one icon per frame. All frames must share one size,
 * as Windows draws a pointer at a single size.
 */
export const writeAni = ({ frames, steps }: AnimatedCursor): Uint8Array => {
  if (!frames.length || !steps.length) {
    throw new Error('An animation needs at least one frame and one step');
  }

  const [first] = frames;

  frames.forEach((frame, index) => {
    if (frame.width !== first.width || frame.height !== first.height) {
      throw new Error(
        `Frame ${index + 1} is ${frame.width}x${frame.height}, but frame 1 is ${first.width}x${first.height}`,
      );
    }
  });

  steps.forEach((step, index) => {
    if (
      !Number.isInteger(step.frame) ||
      step.frame < 0 ||
      step.frame >= frames.length
    ) {
      throw new Error(`Step ${index + 1} shows a frame that does not exist`);
    }

    if (!Number.isInteger(step.jiffies) || step.jiffies < 1) {
      throw new Error(`Step ${index + 1} needs a duration of at least 1 jiffy`);
    }
  });

  const header = new Uint8Array(36);
  const view = new DataView(header.buffer);

  view.setUint32(0, 36, true);
  view.setUint32(4, frames.length, true);
  view.setUint32(8, steps.length, true);
  view.setUint32(12, first.width, true);
  view.setUint32(16, first.height, true);
  view.setUint32(28, steps[0].jiffies, true);
  // Frames are icons, and a sequence follows
  view.setUint32(32, 3, true);

  const icons = frames.map((frame) => chunk('icon', writeCur([frame])));
  const list = chunk(
    'LIST',
    concat([Uint8Array.from(textBytes('fram')), ...icons]),
  );
  const body = concat([
    Uint8Array.from(textBytes('ACON')),
    chunk('anih', header),
    chunk('rate', uint32s(steps.map((step) => step.jiffies))),
    chunk('seq ', uint32s(steps.map((step) => step.frame))),
    list,
  ]);

  return chunk('RIFF', body);
};
