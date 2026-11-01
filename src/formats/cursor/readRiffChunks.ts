/** One chunk of a RIFF body */
export interface RiffChunk {
  id: string;
  data: Uint8Array;
}

const HEADER_LENGTH = 8;

/**
 * Lists the chunks between `start` and the end of `bytes`. The declared size
 * of the enclosing form is never used, since retail files write the whole file
 * length there; a chunk that claims more than the bytes present is an error.
 * Every chunk spans at least its 8 byte header, so a zero size cannot stall
 * the walk.
 */
export const readRiffChunks = (
  bytes: Uint8Array,
  start: number,
  context: string,
): RiffChunk[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: RiffChunk[] = [];
  let at = start;

  while (at + HEADER_LENGTH <= bytes.length) {
    const size = view.getUint32(at + 4, true);
    const dataStart = at + HEADER_LENGTH;

    if (size > bytes.length - dataStart) {
      throw new Error(`${context}: a chunk at byte ${at} runs past the end`);
    }

    chunks.push({
      id: String.fromCharCode(...bytes.subarray(at, at + 4)),
      data: bytes.subarray(dataStart, dataStart + size),
    });
    at = dataStart + size + (size & 1);
  }

  return chunks;
};
