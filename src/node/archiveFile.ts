import { open, rename, unlink } from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import {
  HEADER_LENGTH,
  NotAnArchiveError,
  parseHeader,
  parseIndexTable,
  computeArchiveLayout,
  serializeIndexTable,
} from '../formats/big/bigFormat';
import type { ArchiveLayout, BigFileEntry, ArchiveIndex } from '../formats/big/bigFormat';

/** How much of an entry is held in memory at a time while its data is copied */
const COPY_CHUNK_SIZE = 256 * 1024;

/**
 * Reads an archive's header and index table, leaving the entry data unread.
 * This is the whole cost of opening an archive: nothing else is read until a
 * caller asks for an entry.
 * @throws NotAnArchiveError when the file is too short to hold a header, or
 * does not start with a BIG magic. Other errors when an entry's data runs past
 * the end of the file, so a damaged archive fails at open rather than when
 * someone reads the one broken entry.
 */
export const readArchiveIndexTable = async (
  archivePath: string,
): Promise<ArchiveIndex> => {
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
      throw new NotAnArchiveError('File too small to hold a BIG header');
    }

    const header = parseHeader(headerBuffer);
    const { size: fileSize } = await archiveFile.stat();

    const hasInvalidDataOffset =
      header.dataOffset < HEADER_LENGTH || header.dataOffset > fileSize;

    if (hasInvalidDataOffset) {
      throw new Error(
        `Entry data starts at ${header.dataOffset}, ` +
          `outside the archive of ${fileSize} bytes`,
      );
    }

    const tableLength = header.dataOffset - HEADER_LENGTH;
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

    const indexTable = parseIndexTable(table, header.entryCount);

    indexTable.entries.forEach((entry) => {
      if (entry.offset + entry.size > fileSize) {
        throw new Error(
          `Entry '${entry.name}' spans ${entry.offset} to ` +
            `${entry.offset + entry.size}, past the archive end at ${fileSize}`,
        );
      }
    });

    return {
      magic: header.magic,
      trailer: Uint8Array.from(table.subarray(indexTable.tableLength)),
      entries: indexTable.entries,
    };
  } finally {
    await archiveFile.close();
  }
};

/**
 * One archive held open across a run of reads, handed out by
 * `openArchiveReader`. The caller closes it.
 */
export interface ArchiveReader {
  /** Reads one entry's data, or its pending content when it is not in the archive yet */
  readEntry(entry: BigFileEntry): Promise<Uint8Array>;
  /** Closes the file; no read may follow */
  close(): Promise<void>;
}

/**
 * Opens an archive once for reading several entries, instead of paying for
 * an open and a close per entry
 */
export const openArchiveReader = async (
  archivePath: string,
): Promise<ArchiveReader> => {
  const archiveFile = await open(archivePath, 'r');

  return {
    async readEntry(entry: BigFileEntry): Promise<Uint8Array> {
      if (entry.pendingData) {
        return entry.pendingData;
      }

      if (!entry.size) {
        return Buffer.alloc(0);
      }

      const buffer = Buffer.alloc(entry.size);
      const { bytesRead } = await archiveFile.read(
        buffer,
        0,
        entry.size,
        entry.offset,
      );

      if (bytesRead < entry.size) {
        throw new Error(
          `Archive ends inside entry '${entry.name}', ` +
            `${bytesRead} of ${entry.size} bytes`,
        );
      }

      return buffer;
    },
    close: () => archiveFile.close(),
  };
};

/**
 * Reads one entry, opening and closing the archive around it; reading several
 * goes through `openArchiveReader` instead. A pending or empty entry is
 * answered without touching the file, which need not exist for those.
 */
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

  const reader = await openArchiveReader(archivePath);

  try {
    return await reader.readEntry(entry);
  } finally {
    await reader.close();
  }
};

/** Copies bytes between two open files in chunks, so an entry never sits in memory whole */
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

/**
 * Rewrites the whole archive through a temporary file that is renamed over the
 * original; one changed entry shifts every offset after it, so there is no
 * partial write. The entries keep their old offsets, so the caller has to
 * apply the layout that comes back. `magic` and `trailer` are written back as
 * the archive was read.
 */
export const writeArchiveFile = async (
  archivePath: string,
  { magic, trailer }: Pick<ArchiveIndex, 'magic' | 'trailer'>,
  entries: readonly BigFileEntry[] | ReadonlyMap<string, BigFileEntry>,
): Promise<ArchiveLayout> => {
  const layout = computeArchiveLayout(entries, trailer);
  const indexTable = serializeIndexTable(magic, layout);

  const tempPath = `${archivePath}.${process.pid}.tmp`;

  try {
    const tempFile = await open(tempPath, 'w');

    let sourceFile: FileHandle | undefined;

    try {
      await tempFile.write(indexTable, 0, indexTable.length, 0);

      for (const { entry, offset, size } of layout.placedEntries) {
        if (!size) {
          continue;
        }

        if (entry.pendingData) {
          await tempFile.write(entry.pendingData, 0, size, offset);
          continue;
        }

        if (entry.pendingFile) {
          const importedFile = await open(entry.pendingFile, 'r');

          try {
            await copyEntryData(importedFile, tempFile, 0, offset, size);
          } finally {
            await importedFile.close();
          }

          continue;
        }

        // only opened once an entry's data still has to come from the original
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

/**
 * Archives at least this large take a changed entry in place when it fits,
 * rather than being rewritten whole. Below it a full rewrite is quick, and
 * it is the safer of the two: it goes through a temporary file, so a crash
 * never leaves a half-written archive.
 */
export const IN_PLACE_THRESHOLD = 64 * 1024 * 1024;

/**
 * Writes new data for one entry over its old data, when it fits in the space
 * the entry holds before the next entry's data starts, and updates its size
 * in the index table. The last entry may grow, extending the file. Resolves
 * to whether the entry was written; when it does not fit, nothing is.
 *
 * Every other byte stays where it is, so a save costs the entry's size, not
 * the archive's: what makes editing one INI in a gigabyte archive instant.
 * Unlike `writeArchiveFile` it is not atomic, which is why only large
 * archives use it.
 */
export const writeEntryInPlace = async (
  archivePath: string,
  entry: BigFileEntry,
  data: Uint8Array,
): Promise<boolean> => {
  const archiveFile = await open(archivePath, 'r+');

  try {
    const headerBuffer = Buffer.alloc(HEADER_LENGTH);

    await archiveFile.read(headerBuffer, 0, HEADER_LENGTH, 0);

    const header = parseHeader(headerBuffer);
    const table = Buffer.alloc(header.dataOffset - HEADER_LENGTH);

    await archiveFile.read(table, 0, table.length, HEADER_LENGTH);

    const { entries } = parseIndexTable(table, header.entryCount);

    // Records are found by walking the table again: the record of this entry
    // is the one at its offset and size, under its stored name when it has one
    let recordAt = HEADER_LENGTH;
    let record: BigFileEntry | undefined;

    for (const candidate of entries) {
      const isEntry =
        candidate.offset === entry.offset &&
        candidate.size === entry.size &&
        (entry.storedName === undefined ||
          candidate.storedName === entry.storedName);

      if (isEntry) {
        record = candidate;
        break;
      }

      // A record is offset and size, four bytes each, then the name and its zero
      recordAt += 9 + Buffer.byteLength(candidate.storedName ?? '', 'latin1');
    }

    if (!record) {
      return false;
    }

    const nextOffset = Math.min(
      ...entries
        .filter((candidate) => candidate.offset > record.offset)
        .map((candidate) => candidate.offset),
    );
    const isLast = !Number.isFinite(nextOffset);

    if (!isLast && record.offset + data.length > nextOffset) {
      return false;
    }

    await archiveFile.write(data, 0, data.length, record.offset);

    const size = Buffer.alloc(4);

    size.writeUInt32BE(data.length, 0);
    await archiveFile.write(size, 0, 4, recordAt + 4);

    // The last entry's end is the file's end, so the file and the header's
    // size follow it; elsewhere the old bytes past the new end stay as a gap
    if (isLast) {
      const end = record.offset + data.length;
      const total = Buffer.alloc(4);

      await archiveFile.truncate(end);
      total.writeUInt32LE(end, 0);
      await archiveFile.write(total, 0, 4, 4);
    }

    await archiveFile.sync();

    return true;
  } finally {
    await archiveFile.close();
  }
};
