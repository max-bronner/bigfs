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
  offset: number;
  size: number;
  /** Content that is not in the archive yet */
  pendingData?: Uint8Array;
  /** File on disk whose content is copied in when the archive is written */
  pendingFile?: string;
}

/**
 * Result of reading one archive's index table: the magic to write back
 * unchanged, and the entries keyed by entry path in the casing the archive
 * stored, which the model re-keys for case insensitive lookup.
 */
export interface ParsedArchive {
  magic: string;
  entries: Map<string, BigFileEntry>;
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
  totalSize: number;
}

/**
 * Bytes before the first index table record: magic, archive size, entry count
 * and index table end offset, four bytes each.
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

/** Entry names are stored with backslashes; everything above this layer uses '/' */
const toTreeName = (name: string): string => name.replace(/\\/g, '/');

/** The inverse of `toTreeName`, applied to every name on the way back to disk */
const toStoredName = (name: string): string => name.replace(/\//g, '\\');

/**
 * Reads the 16 byte header: magic, archive size, entry count, and the offset
 * the index table ends at. Only the archive size is little endian; every other
 * number in the format is big endian.
 * @throws NotAnArchiveError when the magic is neither BIGF nor BIG4
 */
export const parseHeader = (buffer: Buffer) => {
  const magic = buffer.toString('ascii', 0, 4);
  if (!MAGICS.has(magic)) {
    throw new NotAnArchiveError(`Invalid BIG file magic: '${magic}'`);
  }

  const archiveSize = buffer.readUInt32LE(4); // the one little endian field
  const entryCount = buffer.readUInt32BE(8);
  const indexTableEndOffset = buffer.readUInt32BE(12);

  return {
    archiveSize,
    indexTableEndOffset,
    magic,
    entryCount,
  };
};

/**
 * Reads `entryCount` records from the table that follows the header, each a
 * big endian offset and size followed by a null terminated name. Throws when
 * the table ends before the count is met, rather than returning what it got.
 */
export const parseIndexTable = (
  table: Buffer,
  entryCount: number,
): BigFileEntry[] => {
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

    entries.push({
      name: toTreeName(table.toString('utf-8', nameStart, nameEnd)),
      offset,
      size,
    });

    cursor = nameEnd + 1;
  }

  return entries;
};

/**
 * Places every entry after the index table in map order, each start rounded up
 * to a 4 byte boundary. A size comes from pending content where there is any,
 * so the layout describes the archive about to be written, not the one on disk.
 */
export const computeArchiveLayout = (
  entries: Map<string, BigFileEntry>,
): ArchiveLayout => {
  const entriesArray = Array.from(entries.values());

  const indexTableEndOffset = entriesArray.reduce(
    (total, entry) =>
      total + 8 + Buffer.byteLength(toStoredName(entry.name), 'utf-8') + 1,
    HEADER_LENGTH,
  );

  const placedEntries: PlacedEntry[] = [];
  let dataOffset = alignBytes(indexTableEndOffset);

  entriesArray.forEach((entry) => {
    const size = entry.pendingData?.length ?? entry.size;
    placedEntries.push({ entry, offset: dataOffset, size });
    dataOffset = alignBytes(dataOffset + size);
  });

  const last = placedEntries[placedEntries.length - 1];
  const totalSize = last ? last.offset + last.size : indexTableEndOffset;

  return { placedEntries, indexTableEndOffset, totalSize };
};

/** Writes one record and returns the offset the next one starts at */
const writeIndexTableEntry = (
  buffer: Buffer,
  offset: number,
  placedEntry: PlacedEntry,
): number => {
  buffer.writeUInt32BE(placedEntry.offset, offset);
  buffer.writeUInt32BE(placedEntry.size, offset + 4);

  const nameBytes = Buffer.from(toStoredName(placedEntry.entry.name), 'utf-8');
  nameBytes.copy(buffer, offset + 8);
  buffer[offset + 8 + nameBytes.length] = 0; // null terminator

  return offset + 8 + nameBytes.length + 1;
};

/**
 * Writes the header and the index table into one buffer, padded out to the
 * boundary where entry data begins. The archive size in the header is the
 * total size the layout arrived at, counting data not yet written.
 */
export const serializeIndexTable = (
  magic: string,
  layout: ArchiveLayout,
): Buffer => {
  const { placedEntries, indexTableEndOffset, totalSize } = layout;
  const buffer = Buffer.alloc(alignBytes(indexTableEndOffset));

  buffer.write(magic, 0, 4, 'ascii');
  buffer.writeUInt32LE(totalSize, 4);
  buffer.writeUInt32BE(placedEntries.length, 8);
  buffer.writeUInt32BE(indexTableEndOffset, 12);

  let cursor = HEADER_LENGTH;
  placedEntries.forEach((placedEntry) => {
    cursor = writeIndexTableEntry(buffer, cursor, placedEntry);
  });

  return buffer;
};
