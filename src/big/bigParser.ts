import type { ArchiveLayout, BigFileEntry, PlacedEntry } from '../types';

export const LENGTH_HEADER = 16;

const alignBytes = (offset: number): number => {
  return (offset + 3) & ~3;
};

export const readHeaders = (buffer: Buffer) => {
  // Read header (16 bytes total)
  const magic = buffer.toString('ascii', 0, 4);
  if (!magic.includes('BIG')) {
    throw new Error(`Invalid BIG file magic: '${magic}'`);
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

export const computeArchiveLayout = (
  entries: Map<string, BigFileEntry>,
): ArchiveLayout => {
  const entriesArray = Array.from(entries.values());

  const indexTableEndOffset = entriesArray.reduce(
    (total, entry) => total + 8 + Buffer.byteLength(entry.name, 'utf-8') + 1,
    LENGTH_HEADER,
  );

  const placedEntries: PlacedEntry[] = [];
  let dataOffset = alignBytes(indexTableEndOffset);

  entriesArray.forEach((entry) => {
    const size = entry.fileBuffer ? entry.fileBuffer.length : entry.size;
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

  const nameBytes = Buffer.from(placedEntry.entry.name, 'utf-8');
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

  let cursor = LENGTH_HEADER;
  placedEntries.forEach((placedEntry) => {
    cursor = writeIndexTableEntry(buffer, cursor, placedEntry);
  });

  return buffer;
};
