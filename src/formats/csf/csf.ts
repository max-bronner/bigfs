import {
  decodeWindows1252,
  encodeWindows1252,
  unencodableCharacters,
} from '../../core/windows1252';
/**
 * The `.csf` compiled string table, ported from mint's
 * `crates/sage/str/src/csf.rs` (layout from `GameText.cpp`'s `parseCSF`):
 *
 * ```
 * header  " FSC" u32 version, u32 labels, u32 strings, u32 reserved, u32 language
 * label   " LBL" u32 string count, u32 name length, name (Windows-1252)
 * string  " RTS" u32 length, UTF-16LE with every bit inverted
 *      or "WRTS" the same, then u32 length, speech file name
 * ```
 *
 * The game reads only the first string of a label. Every string is kept
 * anyway, so a file written back is the file read when nothing changed.
 */

export interface CsfString {
  text: string;
  /** The speech file of a `WRTS` string; absent for `RTS` */
  speech?: string;
}

export interface CsfLabel {
  name: string;
  strings: CsfString[];
}

export interface CsfFile {
  version: number;
  /** The header's fourth word, which the game skips */
  reserved: number;
  language: number;
  labels: CsfLabel[];
}

const HEADER_LENGTH = 24;

const tag = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(...bytes.subarray(at, at + 4));

const encodeCp1252 = (text: string): number[] =>
  Array.from(encodeWindows1252(text));

/**
 * Why a label or speech file name cannot be saved, if it cannot: a `.csf`
 * stores both as Windows-1252 bytes
 */
export const csfNameProblem = (name: string): string | undefined => {
  const missing = unencodableCharacters(name);

  return missing.length
    ? `${missing.map((char) => JSON.stringify(char)).join(' ')} cannot be stored in a .csf, which writes labels and speech names in Windows-1252`
    : undefined;
};

/**
 * A cell's new text with the line breaks the old one used. A page's text
 * field reports every break as `\n`, so a cell written with `\r\n` would
 * otherwise lose its carriage returns the first time it is edited.
 */
export const keepLineBreaks = (previous: string, typed: string): string =>
  previous.includes('\r\n') && !/(?<!\r)\n/.test(previous)
    ? typed.replace(/\r?\n/g, '\r\n')
    : typed;

/** Parses a `.csf`; every length is checked against the bytes present */
export const parseCsf = (bytes: Uint8Array): CsfFile => {
  if (bytes.length < HEADER_LENGTH || tag(bytes, 0) !== ' FSC') {
    throw new Error('Not a CSF string table');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = HEADER_LENGTH;
  const need = (length: number, what: string) => {
    if (length > bytes.length - at) {
      throw new Error(`The ${what} at ${at} runs past the end of the file`);
    }
  };
  const u32 = (what: string) => {
    need(4, what);
    at += 4;

    return view.getUint32(at - 4, true);
  };
  const labels: CsfLabel[] = [];

  while (at < bytes.length) {
    need(4, 'label tag');

    if (tag(bytes, at) !== ' LBL') {
      throw new Error(
        `Expected a label at ${at}, found ${JSON.stringify(tag(bytes, at))}`,
      );
    }

    at += 4;

    const count = u32('string count');
    const nameLength = u32('label length');

    need(nameLength, 'label');

    const name = decodeWindows1252(bytes.subarray(at, at + nameLength));
    const strings: CsfString[] = [];

    at += nameLength;

    for (let index = 0; index < count; index++) {
      need(4, 'string tag');

      const kind = tag(bytes, at);

      if (kind !== ' RTS' && kind !== 'WRTS') {
        throw new Error(
          `Expected a string at ${at}, found ${JSON.stringify(kind)}`,
        );
      }

      at += 4;

      const length = u32('string length');

      need(length * 2, 'string');

      const units = new Uint16Array(length);

      for (let unit = 0; unit < length; unit++) {
        units[unit] = ~view.getUint16(at + unit * 2, true) & 0xffff;
      }

      at += length * 2;

      const string: CsfString = { text: String.fromCharCode(...units) };

      if (kind === 'WRTS') {
        const speechLength = u32('speech length');

        need(speechLength, 'speech name');
        string.speech = decodeWindows1252(
          bytes.subarray(at, at + speechLength),
        );
        at += speechLength;
      }

      strings.push(string);
    }

    labels.push({ name, strings });
  }

  return {
    version: view.getUint32(4, true),
    reserved: view.getUint32(16, true),
    language: view.getUint32(20, true),
    labels,
  };
};

/** Writes a `.csf`, with the header counts made from the labels */
export const writeCsf = (file: CsfFile): Uint8Array => {
  const out: number[] = [];
  const word = (value: number) =>
    out.push(
      value & 255,
      (value >>> 8) & 255,
      (value >>> 16) & 255,
      (value >>> 24) & 255,
    );
  const text = (value: string) =>
    out.push(...Array.from(value, (char) => char.charCodeAt(0)));

  text(' FSC');
  word(file.version);
  word(file.labels.length);
  word(file.labels.reduce((sum, label) => sum + label.strings.length, 0));
  word(file.reserved);
  word(file.language);

  for (const label of file.labels) {
    const name = encodeCp1252(label.name);

    text(' LBL');
    word(label.strings.length);
    word(name.length);
    out.push(...name);

    for (const string of label.strings) {
      text(string.speech === undefined ? ' RTS' : 'WRTS');
      word(string.text.length);

      for (let index = 0; index < string.text.length; index++) {
        const unit = ~string.text.charCodeAt(index) & 0xffff;

        out.push(unit & 255, unit >>> 8);
      }

      if (string.speech !== undefined) {
        const speech = encodeCp1252(string.speech);

        word(speech.length);
        out.push(...speech);
      }
    }
  }

  return Uint8Array.from(out);
};
