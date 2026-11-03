/**
 * The Create-a-Hero file (`MyHero_<id>.cah`), ported from mint's
 * `crates/sage/cah` (`hero.rs`, `crc.rs`), which is the source of truth for
 * the layout and the checksum:
 *
 * ```
 * ALAE 2STR  u32 container version (1)  u32 tagged flag (0)
 * u8 record version (1..8)  u32 object id  wide name  u32 class  u32 subclass
 * u32 x2 reserved  u32 x3 colours  15 x (ascii button, u32 level, u32 slot)
 * u32 bling count, then (ascii group, u32 index) each
 * ascii id (version > 6)  u8 system flag + u32 CRC-32 (version 8)
 * ```
 *
 * A string is a `u8` length, or `0xFF` and a `u32` length; a wide string
 * counts UTF-16 units. Ascii strings are kept as one character per byte, so
 * a file written back keeps every byte it was read with.
 */

import { createByteReader } from "../../core/byteReader";

/** Number of power slots every hero record stores */
export const POWER_SLOTS = 15;

const MAGIC = "ALAE";
const CONTAINER_V1 = "1STR";
const CONTAINER_V2 = "2STR";
const RECORD_VERSION = 8;
const LONG_STRING = 0xff;
/** The least a bling entry takes: an empty-looking length byte, one name byte, its index */
const MIN_BLING_BYTES = 5;

/** One power slot of a hero: the button picked and when */
export interface CahPower {
  /** Command button name; empty for an unused slot */
  button: string;
  /** Zero-based level at which the power was picked */
  level: number;
  /** Slot in the command set */
  slot: number;
}

/** One cosmetic or attribute choice: a bling group and the index picked in it */
export interface CahBling {
  group: string;
  index: number;
}

/** One hero record, every field of the file layout above */
export interface CahRecord {
  /** Record version as read; {@link writeCah} always writes the current one */
  version: number;
  objectId: number;
  /** UTF-16 code units, as stored */
  name: string;
  classIndex: number;
  subclassIndex: number;
  reserved: [number, number];
  /** Packed `A<<24 | R<<16 | G<<8 | B`, in file order */
  colors: [number, number, number];
  powers: CahPower[];
  blings: CahBling[];
  /** Absent before record version 7 */
  id?: string;
  /** Absent before record version 8 */
  isSystem?: boolean;
  /** The trailer as read, which {@link writeCah} ignores */
  storedCrc?: number;
}

/** Result of `parseCah`: the record and how well the file checked out */
export interface ParsedCah {
  record: CahRecord;
  /** Whether the trailer matches the recomputed checksum; true before version 8 */
  crcMatches: boolean;
  /** Bytes after the record, which the game ignores */
  trailing: number;
}

/** Creates a blank current-version record, every power slot empty */
export const createEmptyCahRecord = (): CahRecord => ({
  version: RECORD_VERSION,
  objectId: 0,
  name: "",
  classIndex: 0,
  subclassIndex: 0,
  reserved: [0, 0],
  colors: [0xffffffff, 0xff707070, 0xffffffff],
  powers: Array.from({ length: POWER_SLOTS }, () => ({
    button: "",
    level: 0,
    slot: 0,
  })),
  blings: [],
  id: "",
  isSystem: false,
});

/** Copies a record deeply enough that editing the copy leaves the original alone */
export const cloneCahRecord = (record: CahRecord): CahRecord => ({
  ...record,
  reserved: [...record.reserved],
  colors: [...record.colors],
  powers: record.powers.map((power) => ({ ...power })),
  blings: record.blings.map((bling) => ({ ...bling })),
});

/** Lookup table for the zlib (ISO-HDLC) CRC-32 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let byte = 0; byte < 256; byte++) {
    let value = byte;

    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[byte] = value >>> 0;
  }
  return table;
})();

/** Incremental zlib (ISO-HDLC) CRC-32, fed in pieces */
export class Crc32 {
  private state = 0xffffffff;

  /** Feeds bytes into the checksum; each value is taken as one byte */
  public update(bytes: ArrayLike<number>): void {
    for (let at = 0; at < bytes.length; at++) {
      this.state =
        CRC_TABLE[(this.state ^ bytes[at]) & 0xff] ^ (this.state >>> 8);
    }
  }

  /** Gets the checksum of everything fed so far */
  public finish(): number {
    return ~this.state >>> 0;
  }
}

const u32Bytes = (value: number): number[] => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

/** Cuts text at its first NUL, as the game's C strings end there */
const cutAtNul = (text: string): string => {
  const end = text.indexOf("\0");

  return end < 0 ? text : text.slice(0, end);
};

const latin1Bytes = (text: string): number[] =>
  Array.from(text, (char) => char.charCodeAt(0) & 0xff);

/**
 * Computes the checksum the trailer carries, as mint's `compute_crc` feeds it: the
 * hashed fields in file order with no length prefixes, strings cut at their
 * first NUL, the name as UTF-8 with unpaired surrogates replaced.
 */
export const computeCahCrc = (record: CahRecord): number => {
  const crc = new Crc32();

  crc.update(u32Bytes(record.objectId));
  crc.update(new TextEncoder().encode(cutAtNul(record.name)));
  crc.update(u32Bytes(record.classIndex));
  crc.update(u32Bytes(record.subclassIndex));
  for (const word of [...record.reserved, ...record.colors]) {
    crc.update(u32Bytes(word));
  }
  for (const power of record.powers) {
    crc.update(latin1Bytes(cutAtNul(power.button)));
    crc.update(u32Bytes(power.level));
    crc.update(u32Bytes(power.slot));
  }
  crc.update(u32Bytes(record.blings.length));
  for (const bling of record.blings) {
    crc.update(latin1Bytes(cutAtNul(bling.group)));
    crc.update(u32Bytes(bling.index));
  }
  crc.update([record.isSystem ? 1 : 0]);
  return crc.finish();
};

/** Creates the little-endian reader `parseCah` uses, naming the field that runs past the bytes present */
const createCahReader = (bytes: Uint8Array) => {
  let what = "";
  const reader = createByteReader(bytes, true, {
    describeOverrun: (offset) =>
      `The ${what} at byte ${offset} runs past the end of the file`,
  });
  const take = (label: string, length: number): Uint8Array => {
    what = label;
    return reader.bytes(length);
  };
  const u8 = (label: string): number => {
    what = label;
    return reader.u8();
  };
  const u32 = (label: string): number => {
    what = label;
    return reader.u32();
  };
  const length = (label: string): number => {
    const short = u8(label);

    return short === LONG_STRING ? u32(label) : short;
  };

  return {
    get at() {
      return reader.offset;
    },
    get remaining() {
      return reader.remaining;
    },
    u8,
    u32,
    tag: (label: string): string => String.fromCharCode(...take(label, 4)),
    ascii: (label: string): string =>
      String.fromCharCode(...take(label, length(label))),
    wide: (label: string): string => {
      const units = length(label);
      const raw = take(label, units * 2);
      const text: string[] = [];

      for (let at = 0; at < raw.length; at += 2) {
        text.push(String.fromCharCode(raw[at] | (raw[at + 1] << 8)));
      }
      return text.join("");
    },
  };
};

/**
 * Parses a hero file; every length is checked against the bytes present, and
 * a file that cannot be read throws an error saying why
 */
export const parseCah = (bytes: Uint8Array): ParsedCah => {
  const reader = createCahReader(bytes);

  if (reader.tag("container magic") !== MAGIC) {
    throw new Error("Not a hero file: bad container magic");
  }

  const container = reader.tag("container tag");
  let containerVersion = 0;

  if (container === CONTAINER_V2) {
    containerVersion = reader.u32("container version");
  } else if (container !== CONTAINER_V1) {
    throw new Error("Not a hero file: bad container tag");
  }
  if (containerVersion > 1) {
    throw new Error(`Unsupported container version ${containerVersion}`);
  }
  if (reader.u32("tagged flag") !== 0) {
    throw new Error("A tagged container is not supported");
  }

  const version = reader.u8("record version");

  if (version < 1 || version > RECORD_VERSION) {
    throw new Error(`Unsupported record version ${version}`);
  }

  const record = createEmptyCahRecord();

  record.version = version;
  record.objectId = reader.u32("object id");
  record.name = reader.wide("name");
  record.classIndex = reader.u32("class index");
  record.subclassIndex = reader.u32("subclass index");
  record.reserved = [reader.u32("reserved word"), reader.u32("reserved word")];
  record.colors = [
    reader.u32("colour"),
    reader.u32("colour"),
    reader.u32("colour"),
  ];
  record.powers = [];
  for (let slot = 0; slot < POWER_SLOTS; slot++) {
    record.powers.push({
      button: reader.ascii("power button"),
      level: reader.u32("power level"),
      slot: reader.u32("power slot"),
    });
  }

  const count = reader.u32("bling count");

  if (count > Math.floor(reader.remaining / MIN_BLING_BYTES)) {
    throw new Error(
      `The bling list at byte ${reader.at} claims ${count} entries but only ${reader.remaining} bytes follow`,
    );
  }
  record.blings = [];
  for (let entry = 0; entry < count; entry++) {
    const offset = reader.at;
    const group = reader.ascii("bling group");

    if (!group) {
      throw new Error(`Empty bling group name at byte ${offset}`);
    }
    record.blings.push({ group, index: reader.u32("bling index") });
  }

  record.id = version > 6 ? reader.ascii("hero id") : undefined;
  record.isSystem = version > 7 ? reader.u8("system flag") !== 0 : undefined;
  record.storedCrc = version > 7 ? reader.u32("checksum") : undefined;

  return {
    record,
    crcMatches:
      record.storedCrc === undefined ||
      record.storedCrc === computeCahCrc(record),
    trailing: reader.remaining,
  };
};

const writeLength = (out: number[], length: number): void => {
  if (length < LONG_STRING) {
    out.push(length);
  } else {
    out.push(LONG_STRING, ...u32Bytes(length));
  }
};

const writeAscii = (out: number[], text: string): void => {
  writeLength(out, text.length);
  out.push(...latin1Bytes(text));
};

/** Serialises a record as a current-version file with a freshly computed trailer */
export const writeCah = (record: CahRecord): Uint8Array => {
  const out: number[] = [];

  out.push(...latin1Bytes(MAGIC), ...latin1Bytes(CONTAINER_V2));
  out.push(...u32Bytes(1), ...u32Bytes(0), RECORD_VERSION);
  out.push(...u32Bytes(record.objectId));
  writeLength(out, record.name.length);
  for (let at = 0; at < record.name.length; at++) {
    const unit = record.name.charCodeAt(at);

    out.push(unit & 0xff, unit >>> 8);
  }
  out.push(...u32Bytes(record.classIndex), ...u32Bytes(record.subclassIndex));
  for (const word of [...record.reserved, ...record.colors]) {
    out.push(...u32Bytes(word));
  }
  for (const power of record.powers) {
    writeAscii(out, power.button);
    out.push(...u32Bytes(power.level), ...u32Bytes(power.slot));
  }
  out.push(...u32Bytes(record.blings.length));
  for (const bling of record.blings) {
    writeAscii(out, bling.group);
    out.push(...u32Bytes(bling.index));
  }
  writeAscii(out, record.id ?? "");
  out.push(record.isSystem ? 1 : 0, ...u32Bytes(computeCahCrc(record)));
  return Uint8Array.from(out);
};

/** Explains why a record cannot be saved, or undefined when it can */
export const describeCahRecordProblem = (record: CahRecord): string | undefined => {
  if (record.powers.length !== POWER_SLOTS) {
    return `A hero has ${POWER_SLOTS} power slots`;
  }
  if (record.blings.some((bling) => !bling.group)) {
    return "A bling needs a group name; the game refuses an empty one";
  }

  const wide = [record.id ?? "", ...record.powers.map((p) => p.button)].concat(
    record.blings.map((bling) => bling.group),
  );

  return wide.some((text) => /[^\0-\xff]/.test(text))
    ? "Names are stored one byte per character, so they cannot hold characters beyond Latin-1"
    : undefined;
};
