import { open } from 'fs/promises';
import { LENGTH_HEADER, readHeaders } from './bigParser';

export interface IndexTableEntry {
  name: string;
  offset: number;
  size: number;
}

export interface ArchiveIndexTable {
  magic: string;
  archiveSize: number;
  entries: Map<string, IndexTableEntry>;
}

const parseIndexTable = (
  table: Buffer,
  entryCount: number,
): IndexTableEntry[] => {
  const entries: IndexTableEntry[] = [];
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
      name: table.toString('utf-8', nameStart, nameEnd).replace(/\\/g, '/'),
      offset,
      size,
    });

    cursor = nameEnd + 1;
  }

  return entries;
};

export const readArchiveIndexTable = async (
  archivePath: string,
): Promise<ArchiveIndexTable> => {
  const archiveFile = await open(archivePath, 'r');

  try {
    const headerBuffer = Buffer.alloc(LENGTH_HEADER);
    const { bytesRead } = await archiveFile.read(headerBuffer, 0, LENGTH_HEADER, 0);

    if (bytesRead < LENGTH_HEADER) {
      throw new Error('File too small to be a valid BIG archive');
    }

    const header = readHeaders(headerBuffer);

    const tableLength = Math.max(header.indexTableEndOffset - LENGTH_HEADER, 0);
    const table = Buffer.alloc(tableLength);
    if (tableLength) {
      await archiveFile.read(table, 0, tableLength, LENGTH_HEADER);
    }

    const entries = new Map<string, IndexTableEntry>();
    const indexTable = parseIndexTable(table, header.entryCount);

    indexTable.forEach((entry) => entries.set(entry.name, entry));

    return { magic: header.magic, archiveSize: header.archiveSize, entries };
  } finally {
    await archiveFile.close();
  }
};

export const readEntryData = async (
  archivePath: string,
  entry: IndexTableEntry,
): Promise<Buffer> => {
  if (!entry.size) {
    return Buffer.alloc(0);
  }

  const archiveFile = await open(archivePath, 'r');

  try {
    const buffer = Buffer.alloc(entry.size);
    await archiveFile.read(buffer, 0, entry.size, entry.offset);
    return buffer;
  } finally {
    await archiveFile.close();
  }
};
