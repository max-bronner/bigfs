import type { BigFileEntry, BigFileArchive } from '../types';

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

export const parseBigArchive = (buffer: Buffer): BigFileArchive => {
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

interface ArchiveLayout {
  indexTableEndOffset: number;
  dataOffset: number;
  totalSize: number;
}

const calculateBufferSizes = (
  entries: Map<string, BigFileEntry>,
): ArchiveLayout => {
  let totalMetaSize = 0;
  let totalDataSize = 0;
  const entriesArray = Array.from(entries.values());

  entriesArray.forEach((entry, index) => {
    const isLast = index === entriesArray.length - 1;

    const nameLength = Buffer.byteLength(entry.name, 'utf-8');
    const entryMetaSize = 8 + nameLength + 1;
    totalMetaSize += entryMetaSize;

    const entryDataSize = isLast
      ? entry.fileBuffer.length
      : alignBytes(entry.fileBuffer.length);
    totalDataSize += entryDataSize;
  });

  const indexTableEndOffset = LENGTH_HEADER + totalMetaSize;
  const dataOffset = alignBytes(indexTableEndOffset);
  const totalSize = dataOffset + totalDataSize;

  return { indexTableEndOffset, dataOffset, totalSize };
};

const writeIndexTableEntry = (
  buffer: Buffer,
  offset: number,
  entry: BigFileEntry,
): number => {
  buffer.writeUInt32BE(entry.offset, offset);
  buffer.writeUInt32BE(entry.size, offset + 4);

  const nameBytes = Buffer.from(entry.name, 'utf-8');
  nameBytes.copy(buffer, offset + 8);
  buffer[offset + 8 + nameBytes.length] = 0; // null terminator

  return offset + 8 + nameBytes.length + 1;
};

export const writeBigArchive = (archive: BigFileArchive): Buffer => {
  const { indexTableEndOffset, dataOffset, totalSize } = calculateBufferSizes(
    archive.entries,
  );

  const buffer = Buffer.alloc(totalSize);

  buffer.write(archive.magic, 0, 4, 'ascii');
  buffer.writeUInt32LE(totalSize, 4);
  buffer.writeUInt32BE(archive.entries.size, 8);
  buffer.writeUInt32BE(indexTableEndOffset, 12);

  let currentMetaOffset = LENGTH_HEADER;
  let currentDataOffset = dataOffset;

  archive.entries.forEach((entry) => {
    entry.offset = currentDataOffset;
    entry.size = entry.fileBuffer.length;
    currentMetaOffset = writeIndexTableEntry(buffer, currentMetaOffset, entry);

    buffer.set(entry.fileBuffer, entry.offset);
    currentDataOffset += alignBytes(entry.fileBuffer.length);
  });

  return buffer;
};
