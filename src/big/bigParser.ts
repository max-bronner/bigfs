import type {
  ArchiveLayout,
  BigFileEntry,
  ParsedArchive,
  PlacedEntry,
} from '../types';

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

const readEntry = (
  buffer: Buffer,
  index: number,
): BigFileEntry & { nextIndex: number } => {
  if (index + 8 >= buffer.length) {
    throw new Error(`Unexpected end of file`);
  }

  const offset = buffer.readUInt32BE(index);
  const size = buffer.readUInt32BE(index + 4);

  const nameStart = index + 8;
  let nameEnd = nameStart;
  while (nameEnd < buffer.length && buffer[nameEnd] !== 0) {
    nameEnd++;
  }

  if (nameEnd >= buffer.length) {
    throw new Error(`Unexpected end of file`);
  }

  const name = buffer.toString('utf-8', nameStart, nameEnd).replace(/\\/g, '/');
  const nextIndex = nameEnd + 1; // Skip null terminator
  const fileBuffer = buffer.subarray(offset, offset + size); // info: currently a view, could be a copy too

  return {
    offset,
    size,
    name,
    nextIndex,
    fileBuffer,
  };
};

export const parseBigArchive = (buffer: Buffer): ParsedArchive => {
  if (buffer.length < LENGTH_HEADER) {
    throw new Error('File too small to be a valid BIG archive');
  }

  const { magic, archiveSize, entryCount, indexTableEndOffset } =
    readHeaders(buffer);

  const entries = new Map<string, BigFileEntry>();
  let currentOffset = LENGTH_HEADER;

  for (let i = 0; i < entryCount; i++) {
    const { nextIndex, ...entry } = readEntry(buffer, currentOffset);
    entries.set(entry.name, entry);
    currentOffset = nextIndex;
  }

  return {
    magic,
    archiveSize,
    entryCount,
    indexTableEndOffset,
    entries,
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
    const size = entry.fileBuffer.length;
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
