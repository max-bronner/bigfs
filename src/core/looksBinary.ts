/** Bytes looked at for a zero, which is enough to tell text from the formats the games pack */
const SAMPLE_LENGTH = 4096;

/** Whether bytes are probably not text, going by a zero byte near the start, which no text file the games read holds */
export const looksBinary = (bytes: Uint8Array): boolean =>
  bytes.subarray(0, SAMPLE_LENGTH).includes(0);
