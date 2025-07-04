export interface BigFileEntry {
  name: string;
  offset: number;
  size: number;
}

export interface BigFileArchive {
  magic: string;
  fileSize: number;
  numEntries: number;
  indexOffset: number;
  entries: BigFileEntry[];
}

const LENGTH_HEADER = 16;

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

  const name = buffer.toString('utf-8', nameStart, nameEnd);
  const nextIndex = nameEnd + 1; // Skip null terminator

  return {
    offset,
    size,
    name,
    nextIndex,
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
