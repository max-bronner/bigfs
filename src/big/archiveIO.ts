import { open, rename, unlink } from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import {
  HEADER_LENGTH,
  parseHeader,
  parseIndexTable,
  computeArchiveLayout,
  serializeIndexTable,
} from './bigParser';
import type { ArchiveLayout, BigFileEntry, ParsedArchive } from '../types';

/** Buffer size for moving an entry's data between archives */
const COPY_CHUNK_SIZE = 256 * 1024;

export const readArchiveIndexTable = async (
  archivePath: string,
): Promise<ParsedArchive> => {
  const archiveFile = await open(archivePath, 'r');

  try {
    const headerBuffer = Buffer.alloc(HEADER_LENGTH);
    const { bytesRead: headerBytesRead } = await archiveFile.read(
      headerBuffer,
      0,
      HEADER_LENGTH,
      0,
    );

    if (headerBytesRead < HEADER_LENGTH) {
      throw new Error('File too small to be a valid BIG archive');
    }

    const header = parseHeader(headerBuffer);
    const { size: fileSize } = await archiveFile.stat();

    const hasValidIndexTable =
      header.indexTableEndOffset < HEADER_LENGTH ||
      header.indexTableEndOffset > fileSize;

    if (hasValidIndexTable) {
      throw new Error(
        `Index table ends at ${header.indexTableEndOffset}, ` +
          `outside the archive of ${fileSize} bytes`,
      );
    }

    const tableLength = header.indexTableEndOffset - HEADER_LENGTH;
    const table = Buffer.alloc(tableLength);

    if (tableLength) {
      const { bytesRead: tableBytesRead } = await archiveFile.read(
        table,
        0,
        tableLength,
        HEADER_LENGTH,
      );

      if (tableBytesRead < tableLength) {
        throw new Error(
          `Archive ends inside its index table, ${tableBytesRead} of ${tableLength} bytes`,
        );
      }
    }

    const entries = new Map<string, BigFileEntry>();
    const indexTable = parseIndexTable(table, header.entryCount);

    indexTable.forEach((entry) => entries.set(entry.name, entry));

    return { magic: header.magic, entries };
  } finally {
    await archiveFile.close();
  }
};

export const readEntryData = async (
  archivePath: string,
  entry: BigFileEntry,
): Promise<Uint8Array> => {
  if (entry.pendingData) {
    return entry.pendingData;
  }

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

export const writeArchiveFile = async (
  archivePath: string,
  magic: string,
  entries: Map<string, BigFileEntry>,
): Promise<ArchiveLayout> => {
  const layout = computeArchiveLayout(entries);
  const indexTable = serializeIndexTable(magic, layout);

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

        if (entry.pendingData) {
          await tempFile.write(entry.pendingData, 0, size, offset);
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
