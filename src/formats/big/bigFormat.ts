import { isContainedPath } from '../../core/paths';

/**
 * The BIG archive binary format: a header, an index table listing every entry
 * with its data offset and size, and the entry data itself.
 */

/**
 * One file stored in an archive, as the index table records it. `name` is the
 * entry path with '/' separators; the archive stores it with backslashes.
 */
export interface BigFileEntry {
  name: string;
  /**
   * The name exactly as the index table stored it, separators included. Kept
   * so an entry nobody renamed is written back unchanged: the `apt` archives
   * store forward slashes, every other one backslashes.
   */
  storedName?: string;
  offset: number;
  size: number;
  /** Content that is not in the archive yet */
  pendingData?: Uint8Array;
  /** File on disk whose content is copied in when the archive is written */
  pendingFile?: string;
}

/**
 * Result of reading one archive's index table: the magic and trailer to write
 * back unchanged, and every entry in stored order, duplicates included, which
 * the model keys for case insensitive lookup.
 */
export interface ParsedArchive {
  magic: string;
  trailer: Uint8Array;
  entries: BigFileEntry[];
}

/** Where an entry lands in the archive being written, not where it sits now */
export interface PlacedEntry {
  entry: BigFileEntry;
  offset: number;
  size: number;
}

/**
 * Where every entry lands in the archive about to be written: the entries in
 * write order, the offset the index table ends at, and the size of the
 * finished file.
 */
export interface ArchiveLayout {
  placedEntries: PlacedEntry[];
  indexTableEndOffset: number;
  /** Bytes between the index table and the data, written back as they were read */
  trailer: Uint8Array;
  /** Where the first entry's data starts, which the header records at 0x0C */
  dataOffset: number;
  totalSize: number;
}

/**
 * Bytes before the first index table record: magic, archive size, entry count
 * and the offset the first entry's data starts at, four bytes each.
 */
export const HEADER_LENGTH = 16;

/**
 * The four ascii bytes an archive starts with. Both are read the same way, and
 * an archive is written back with the magic it had.
 */
const MAGICS = new Set(['BIGF', 'BIG4']);

/**
 * A file that is not a BIG archive at all. The extension is a naming
 * convention, so this means "not ours" rather than "broken".
 */
export class NotAnArchiveError extends Error {}

/** Rounds up to the next 4 byte boundary, where entry data has to start */
const alignBytes = (offset: number): number => {
  return (offset + 3) & ~3;
};

/**
 * Encoding entry names are read and written with. Names are 8-bit, not
 * UTF-8; Latin-1 is the one decoding that maps every byte to a character and
 * back, so a name survives a save whatever it contains.
 */
const NAME_ENCODING = 'latin1';

/** Converts a stored entry name's backslashes to the '/' everything above this layer uses */
const toTreeName = (name: string): string => name.replace(/\\/g, '/');

/**
 * Gets the name an entry is written with: the stored one when the entry was
 * not renamed, otherwise its path with backslashes
 * @throws when the name holds a character Latin-1 cannot store
 */
const getStoredName = (entry: BigFileEntry): string => {
  if (entry.storedName !== undefined) {
    return entry.storedName;
  }

  if (/[^\u0000-\u00ff]/.test(entry.name)) {
    throw new Error(
      `Entry name cannot be stored in a BIG archive: ${entry.name}`,
    );
  }

  return entry.name.replace(/\//g, '\\');
};

/**
 * Reads the 16 byte header: magic, archive size, entry count, and the offset
 * the first entry's data starts at. Only the archive size is little endian;
 * every other number in the format is big endian.
 * @throws NotAnArchiveError when the magic is neither BIGF nor BIG4
 */
export const parseHeader = (buffer: Buffer) => {
  const magic = buffer.toString('ascii', 0, 4);
  if (!MAGICS.has(magic)) {
    throw new NotAnArchiveError(`Invalid BIG file magic: '${magic}'`);
  }

  const archiveSize = buffer.readUInt32LE(4);
  const entryCount = buffer.readUInt32BE(8);
  const dataOffset = buffer.readUInt32BE(12);

  return {
    archiveSize,
    dataOffset,
    magic,
    entryCount,
  };
};

/**
 * Reads `entryCount` records from the table that follows the header, each a
 * big endian offset and size followed by a null terminated name, and reports
 * how many bytes of the table they took. Throws when the table ends before
 * the count is met, rather than returning what it got, and on a name that
 * would escape the directory it is extracted to.
 */
export const parseIndexTable = (
  table: Buffer,
  entryCount: number,
): { entries: BigFileEntry[]; tableLength: number } => {
  const entries: BigFileEntry[] = [];
  let cursor = 0;

  for (let entryNumber = 0; entryNumber < entryCount; entryNumber++) {
    if (cursor + 8 > table.length) {
      throw new Error(
        `Index table ends after ${entryNumber} of ${entryCount} entries`,
      );
    }

    const offset = table.readUInt32BE(cursor);
    const size = table.readUInt32BE(cursor + 4);

    const nameStart = cursor + 8;
    let nameEnd = nameStart;

    while (nameEnd < table.length && table[nameEnd] !== 0) {
      nameEnd++;
    }

    if (nameEnd >= table.length) {
      throw new Error(`Unterminated name in index table entry ${entryNumber}`);
    }

    const storedName = table.toString(NAME_ENCODING, nameStart, nameEnd);
    const name = toTreeName(storedName);

    if (!isContainedPath(name)) {
      throw new Error(
        `Unsafe name '${name}' in index table entry ${entryNumber}`,
      );
    }

    entries.push({ name, storedName, offset, size });

    cursor = nameEnd + 1;
  }

  return { entries, tableLength: cursor };
};

/**
 * Places every entry after the index table and its trailer in the order given:
 * the first straight after the trailer, as shipped archives have it, and each
 * later one rounded up to a 4 byte boundary. `trailer` is the gap a read found
 * between the table and the data: eight bytes in every shipped BIG4 archive,
 * none in a BIGF one. A size comes from pending content where there is any,
 * so the layout describes the archive about to be written, not the one on disk.
 */
export const computeArchiveLayout = (
  entries: readonly BigFileEntry[] | ReadonlyMap<string, BigFileEntry>,
  trailer: Uint8Array = new Uint8Array(0),
): ArchiveLayout => {
  const entriesArray = Array.isArray(entries)
    ? entries
    : Array.from(entries.values());

  const indexTableEndOffset = entriesArray.reduce(
    (total, entry) =>
      total + 8 + Buffer.byteLength(getStoredName(entry), NAME_ENCODING) + 1,
    HEADER_LENGTH,
  );

  const placedEntries: PlacedEntry[] = [];
  // Not aligned: the next read takes every byte up to the data as trailer, so
  // padding here would grow the trailer by a few bytes on every save
  const firstDataOffset = indexTableEndOffset + trailer.length;
  let dataOffset = firstDataOffset;

  entriesArray.forEach((entry) => {
    const size = entry.pendingData?.length ?? entry.size;
    placedEntries.push({ entry, offset: dataOffset, size });
    dataOffset = alignBytes(dataOffset + size);
  });

  const last = placedEntries[placedEntries.length - 1];
  const totalSize = last ? last.offset + last.size : firstDataOffset;

  return {
    placedEntries,
    indexTableEndOffset,
    trailer,
    dataOffset: firstDataOffset,
    totalSize,
  };
};

/** Writes one record and returns the offset the next one starts at */
const writeIndexTableEntry = (
  buffer: Buffer,
  offset: number,
  placedEntry: PlacedEntry,
): number => {
  buffer.writeUInt32BE(placedEntry.offset, offset);
  buffer.writeUInt32BE(placedEntry.size, offset + 4);

  const nameBytes = Buffer.from(
    getStoredName(placedEntry.entry),
    NAME_ENCODING,
  );
  nameBytes.copy(buffer, offset + 8);
  buffer[offset + 8 + nameBytes.length] = 0;

  return offset + 8 + nameBytes.length + 1;
};

/**
 * Writes the header, the index table and its trailer into one buffer that
 * ends where entry data begins. The archive size in the header
 * is the total size the layout arrived at, counting data not yet written.
 */
export const serializeIndexTable = (
  magic: string,
  layout: ArchiveLayout,
): Buffer => {
  const { placedEntries, indexTableEndOffset, trailer, dataOffset, totalSize } =
    layout;
  const buffer = Buffer.alloc(dataOffset);

  buffer.write(magic, 0, 4, 'ascii');
  buffer.writeUInt32LE(totalSize, 4);
  buffer.writeUInt32BE(placedEntries.length, 8);
  buffer.writeUInt32BE(dataOffset, 12);

  let cursor = HEADER_LENGTH;
  placedEntries.forEach((placedEntry) => {
    cursor = writeIndexTableEntry(buffer, cursor, placedEntry);
  });

  buffer.set(trailer, indexTableEndOffset);

  return buffer;
};
