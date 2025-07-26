export interface BigFileEntry {
  name: string;
  offset: number;
  size: number;
  fileBuffer: Uint8Array;
}

export interface BigFileArchive {
  magic: string;
  fileSize: number;
  numEntries: number;
  indexOffset: number;
  entries: BigFileEntry[];
}

const LENGTH_HEADER = 16;

const alignBytes = (offset: number): number => {
  return (offset + 3) & ~3;
};

const readHeaders = (buffer: NonSharedBuffer) => {
  // Read header (16 bytes total)
  const magic = buffer.toString('ascii', 0, 4);
  if (!magic.includes('BIG')) {
    throw new Error(`Invalid BIG file magic: '${magic}'`);
  }

  const fileSize = buffer.readUInt32LE(4);
  const numEntries = buffer.readUInt32BE(8);
  const indexOffset = buffer.readUInt32BE(12);

  return {
    fileSize,
    indexOffset,
    magic,
    numEntries,
  };
};

const readEntry = (
  buffer: NonSharedBuffer,
  index: number
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

export const parseBigArchive = (buffer: NonSharedBuffer): BigFileArchive => {
  if (buffer.length < LENGTH_HEADER) {
    throw new Error('File too small to be a valid BIG archive');
  }

  const { magic, fileSize, numEntries, indexOffset } = readHeaders(buffer);

  const entries: BigFileEntry[] = [];
  let currentOffset = LENGTH_HEADER;

  for (let i = 0; i < numEntries; i++) {
    const { nextIndex, ...entry } = readEntry(buffer, currentOffset);
    entries.push(entry);
    currentOffset = nextIndex;
  }

  return {
    magic,
    fileSize,
    numEntries,
    indexOffset,
    entries,
  };
};

const calculateBufferSizes = (entries: BigFileEntry[]): number[] => {
  let totalMetaSize = 0;
  let totalDataSize = 0;
  entries.forEach((entry, index) => {
    const isLast = index === entries.length - 1;

    const nameLength = Buffer.byteLength(entry.name, 'utf-8');
    const entryMetaSize = 8 + nameLength + (isLast ? 0 : 1);
    totalMetaSize += entryMetaSize;

    const entryDataSize = isLast
      ? entry.fileBuffer.length
      : alignBytes(entry.fileBuffer.length);
    totalDataSize += entryDataSize;
  });

  return [LENGTH_HEADER, alignBytes(totalMetaSize), totalDataSize];
};

const writeIndexEntry = (
  buffer: Buffer,
  offset: number,
  entry: BigFileEntry
): number => {
  buffer.writeUInt32BE(entry.offset, offset);
  buffer.writeUInt32BE(entry.size, offset + 4);

  const nameBytes = Buffer.from(entry.name, 'utf-8');
  nameBytes.copy(buffer, offset + 8);
  buffer[offset + 8 + nameBytes.length] = 0; // null terminator

  return offset + 8 + nameBytes.length + 1;
};

export const writeBigArchive = (archive: BigFileArchive): Buffer => {
  const [headerSize, metaSize, dataSize] = calculateBufferSizes(
    archive.entries
  );

  const dataOffset = headerSize + metaSize;

  const totalSize = headerSize + metaSize + dataSize;
  const buffer = Buffer.alloc(totalSize);

  buffer.write(archive.magic, 0, 4, 'ascii');
  buffer.writeUInt32LE(totalSize, 4);
  buffer.writeUInt32BE(archive.entries.length, 8);
  buffer.writeUInt32BE(dataOffset - 1, 12); // indexOffset

  let currentMetaOffset = LENGTH_HEADER;
  let currentDataOffset = dataOffset;
  archive.entries.forEach((entry) => {
    entry.offset = currentDataOffset;
    entry.size = entry.fileBuffer.length;
    currentMetaOffset = writeIndexEntry(buffer, currentMetaOffset, entry);

    buffer.set(entry.fileBuffer, dataOffset);
    currentDataOffset += alignBytes(entry.fileBuffer.length);
  });

  return buffer;
};
