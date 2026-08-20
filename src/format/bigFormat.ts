/**
 * The BIG archive binary format: a header, an index table listing every entry
 * with its data offset and size, and the entry data itself.
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

export interface ParsedArchive {
  magic: string;
  entries: Map<string, BigFileEntry>;
}

/** Entry for ArchiveLayout with its location */
export interface PlacedEntry {
  entry: BigFileEntry;
  offset: number;
  size: number;
}

/** Layout for writing archive file */
export interface ArchiveLayout {
  placedEntries: PlacedEntry[];
  indexTableEndOffset: number;
  totalSize: number;
}

export const HEADER_LENGTH = 16;

/** Magics of the supported archive formats */
const MAGICS = new Set(['BIGF', 'BIG4']);

/**
 * A file that is not a BIG archive at all. The extension is a naming
 * convention, so this means "not ours" rather than "broken".
 */
export class NotAnArchiveError extends Error {}

const alignBytes = (offset: number): number => {
  return (offset + 3) & ~3;
};

const toTreeName = (name: string): string => name.replace(/\\/g, '/');

const toStoredName = (name: string): string => name.replace(/\//g, '\\');

export const parseHeader = (buffer: Buffer) => {
  // Read header (16 bytes total)
  const magic = buffer.toString('ascii', 0, 4);
  if (!MAGICS.has(magic)) {
    throw new NotAnArchiveError(`Invalid BIG file magic: '${magic}'`);
  }

  const archiveSize = buffer.readUInt32LE(4);
  const entryCount = buffer.readUInt32BE(8);
  const indexTableEndOffset = buffer.readUInt32BE(12);

  return {
    archiveSize,
    indexTableEndOffset,
    magic,
    entryCount,
  };
};

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
