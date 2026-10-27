/**
 * Windows-1252, the 8-bit encoding the games read their text files, names
 * and strings in. (A `TextDecoder` labelled `latin1` is this encoding too,
 * by the WHATWG Encoding standard.) Every byte decodes to one character and
 * encodes back to the same byte, so text read and written unchanged keeps
 * its bytes.
 */

const decoder = new TextDecoder('windows-1252');

/** The characters of bytes 0x80-0xFF, to their byte */
const UPPER_HALF = new Map(
  Array.from({ length: 128 }, (_, index) => [
    decoder.decode(Uint8Array.of(index + 128)),
    index + 128,
  ]),
);

export const decodeWindows1252 = (bytes: Uint8Array): string =>
  decoder.decode(bytes);

/**
 * Decodes an INI, fragment or string table file. Editors save UTF-8 files
 * with a three byte mark in front, which the games' reader never sees as
 * text and which Windows-1252 would turn into `ï»¿` at the start of the
 * first line, so it is dropped before decoding.
 */
export const decodeIniText = (bytes: Uint8Array): string =>
  decodeWindows1252(
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes,
  );

/**
 * Encodes text; a character the encoding lacks throws, or becomes
 * `replacement` when one is given
 */
export const encodeWindows1252 = (
  text: string,
  replacement?: number,
): Uint8Array =>
  Uint8Array.from(Array.from(text), (char) => {
    const code = char.charCodeAt(0);
    const byte = code < 128 ? code : UPPER_HALF.get(char);

    if (byte !== undefined) {
      return byte;
    }

    if (replacement === undefined) {
      throw new Error(
        `${JSON.stringify(char)} cannot be written in Windows-1252`,
      );
    }

    return replacement;
  });
