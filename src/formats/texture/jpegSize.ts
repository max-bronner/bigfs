const START_OF_IMAGE = 0xd8;
const PADDING = 0xff;

/** Whether a JPEG marker starts a frame, the segment that states the image's size */
const isStartOfFrame = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

/** Whether a JPEG marker stands alone, with no length after it */
const isStandalone = (marker: number): boolean =>
  marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);

/** Reads a JPEG's size from its frame header, or nothing for bytes that are not one */
export const readJpegSize = (
  bytes: Uint8Array,
): [number, number] | undefined => {
  if (bytes[0] !== PADDING || bytes[1] !== START_OF_IMAGE) {
    return undefined;
  }

  let at = 2;

  while (at + 3 < bytes.length) {
    if (bytes[at] !== PADDING) {
      return undefined;
    }

    const marker = bytes[at + 1];

    if (marker === PADDING) {
      at++;
    } else if (isStandalone(marker)) {
      at += 2;
    } else if (isStartOfFrame(marker)) {
      return at + 8 < bytes.length
        ? [
            (bytes[at + 7] << 8) | bytes[at + 8],
            (bytes[at + 5] << 8) | bytes[at + 6],
          ]
        : undefined;
    } else {
      at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
    }
  }
  return undefined;
};
