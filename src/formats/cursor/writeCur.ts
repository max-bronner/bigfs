import type { CursorFrame } from './cursorFrame';
import { assertWritableFrame } from './assertWritableFrame';
import { encodeDib } from './encodeDib';

/** Writes frames as a `.cur` file, one directory entry each, each a 32-bit bitmap with an AND mask */
export const writeCur = (frames: CursorFrame[]): Uint8Array => {
  if (!frames.length) {
    throw new Error('A cursor needs at least one image');
  }

  frames.forEach((frame, index) =>
    assertWritableFrame(frame, `Image ${index + 1}`),
  );

  const dibs = frames.map(encodeDib);
  const directory = 6 + frames.length * 16;
  const out = new Uint8Array(
    directory + dibs.reduce((sum, dib) => sum + dib.length, 0),
  );
  const view = new DataView(out.buffer);
  let offset = directory;

  view.setUint16(2, 2, true);
  view.setUint16(4, frames.length, true);

  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;

    out[entry] = frame.width % 256;
    out[entry + 1] = frame.height % 256;
    view.setUint16(entry + 4, frame.hotspotX, true);
    view.setUint16(entry + 6, frame.hotspotY, true);
    view.setUint32(entry + 8, dibs[index].length, true);
    view.setUint32(entry + 12, offset, true);
    out.set(dibs[index], offset);
    offset += dibs[index].length;
  });

  return out;
};
