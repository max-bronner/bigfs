import { open, readFile, rename, unlink } from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import {
  LENGTH_HEADER,
  parseBigArchive,
  readHeaders,
  computeArchiveLayout,
  serializeIndexTable,
} from './bigParser';
import type { ArchiveLayout, BigFileEntry, ParsedArchive } from '../types';

/** Buffer size for moving an entry's data between archives */
const COPY_CHUNK_SIZE = 256 * 1024;

const parseIndexTable = (table: Buffer, entryCount: number): BigFileEntry[] => {
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
): Promise<ParsedArchive> => {
  const archiveFile = await open(archivePath, 'r');

  try {
    const headerBuffer = Buffer.alloc(LENGTH_HEADER);
    const { bytesRead } = await archiveFile.read(
      headerBuffer,
      0,
      LENGTH_HEADER,
      0,
    );

    if (bytesRead < LENGTH_HEADER) {
      throw new Error('File too small to be a valid BIG archive');
    }

    const header = readHeaders(headerBuffer);

    const tableLength = Math.max(header.indexTableEndOffset - LENGTH_HEADER, 0);
    const table = Buffer.alloc(tableLength);
    if (tableLength) {
      await archiveFile.read(table, 0, tableLength, LENGTH_HEADER);
    }

    const entries = new Map<string, BigFileEntry>();
    const indexTable = parseIndexTable(table, header.entryCount);

    indexTable.forEach((entry) => entries.set(entry.name, entry));

    return {
      magic: header.magic,
      archiveSize: header.archiveSize,
      entryCount: header.entryCount,
      indexTableEndOffset: header.indexTableEndOffset,
      entries,
    };
  } finally {
    await archiveFile.close();
  }
};

export const readEntryData = async (
  archivePath: string,
  entry: BigFileEntry,
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

const copyEntryData = async (
  sourceFile: FileHandle,
  targetFile: FileHandle,
  sourceOffset: number,
  targetOffset: number,
  size: number,
): Promise<void> => {
  const buffer = Buffer.alloc(Math.min(COPY_CHUNK_SIZE, size));
  let copied = 0;

  while (copied < size) {
    const chunk = Math.min(buffer.length, size - copied);
    const { bytesRead } = await sourceFile.read(
      buffer,
      0,
      chunk,
      sourceOffset + copied,
    );

    if (!bytesRead) {
      throw new Error('Unexpected end of archive while copying entry data');
    }

    await targetFile.write(buffer, 0, bytesRead, targetOffset + copied);
    copied += bytesRead;
  }
};

export const readArchiveFile = async (
  archivePath: string,
): Promise<ParsedArchive> => {
  const buffer = await readFile(archivePath);
  return parseBigArchive(buffer);
};

export const writeArchiveFile = async (
  archivePath: string,
  archive: ParsedArchive,
): Promise<ArchiveLayout> => {
  const layout = computeArchiveLayout(archive.entries);
  const indexTable = serializeIndexTable(archive.magic, layout);

  const tempPath = `${archivePath}.${process.pid}.tmp`;

  try {
    const tempFile = await open(tempPath, 'w');

    let sourceFile: FileHandle | undefined;

    try {
      await tempFile.write(indexTable, 0, indexTable.length, 0);

      // Write one entry at a time
      for (const { entry, offset, size } of layout.placedEntries) {
        if (!size) {
          continue;
        }

        if (entry.fileBuffer) {
          await tempFile.write(entry.fileBuffer, 0, size, offset);
          continue;
        }

        sourceFile ??= await open(archivePath, 'r');
        await copyEntryData(sourceFile, tempFile, entry.offset, offset, size);
      }

      await tempFile.truncate(layout.totalSize);
      await tempFile.sync();
    } finally {
      await sourceFile?.close().catch(() => undefined);
      await tempFile.close();
    }

    await rename(tempPath, archivePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }

  return layout;
};
