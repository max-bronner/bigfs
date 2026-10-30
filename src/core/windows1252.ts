/**
 * Windows-1252, the 8-bit encoding the games read their text files, names
 * and strings in. Every byte decodes to one character and
 * encodes back to the same byte, so text read and written unchanged keeps
 * its bytes.
 */

/**
 * Characters bytes 0x80-0x9F decode to. The five the encoding leaves unused
 * decode to the control character of the same number, as the WHATWG
 * standard has it. Spelled out because a `TextDecoder` is not Windows-1252
 * everywhere (Node without full ICU reads it as ISO-8859-1).
 */
const HIGH_CONTROLS =
  '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f' +
  '\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';

/** The characters of bytes 0x80-0xFF, to their byte */
const UPPER_HALF = new Map(
  Array.from({ length: 128 }, (_, index) => [
    index < 32 ? HIGH_CONTROLS[index] : String.fromCharCode(index + 128),
    index + 128,
  ]),
);

/** Bytes decoded per `String.fromCharCode` call, which takes them as arguments and so cannot take a whole file */
const CHUNK = 0x8000;

/** Decodes Windows-1252 bytes, one character per byte */
export const decodeWindows1252 = (bytes: Uint8Array): string => {
  let text = '';

  for (let at = 0; at < bytes.length; at += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return text.replace(
    /[\x80-\x9f]/g,
    (char) => HIGH_CONTROLS[char.charCodeAt(0) - 0x80],
  );
};

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
 * Encodes text as Windows-1252; a character the encoding lacks throws, or becomes
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

/** Lists the distinct characters of `text` the encoding lacks, in order of appearance */
export const unencodableCharacters = (text: string): string[] => [
  ...new Set(
    Array.from(text).filter(
      (char) => char.charCodeAt(0) >= 128 && !UPPER_HALF.has(char),
    ),
  ),
];
