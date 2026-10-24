import { open, readdir } from 'fs/promises';
import * as path from 'path';
import { readArchiveIndexTable } from '../binary/archiveFile';
import { archiveOrderKey } from './gameView';

/**
 * The base game a mod is compared against: every file its archives give the
 * game, after the engine's order (archives sorted by path below the install,
 * the first holding a file winning; inside one archive the last copy wins),
 * read straight from the install folder, which need not be in the workspace.
 */

export interface BaseEntry {
  archive: string;
  offset: number;
  size: number;
}

/** Lowercased, '/' separated entry path to where the base game keeps it */
export type BaseIndex = Map<string, BaseEntry>;

const MAX_DEPTH = 8;

const findArchives = async (folder: string, depth = 0): Promise<string[]> => {
  if (depth > MAX_DEPTH) {
    return [];
  }

  const found: string[] = [];

  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      found.push(...(await findArchives(full, depth + 1)));
    } else if (entry.name.toLowerCase().endsWith('.big')) {
      found.push(full);
    }
  }

  return found;
};

/** Reads every archive's index table under an install folder */
export const indexBaseGame = async (
  folder: string,
): Promise<{ index: BaseIndex; archives: number; unreadable: string[] }> => {
  const archives = (await findArchives(folder)).sort((a, b) =>
    archiveOrderKey(path.relative(folder, a)) <
    archiveOrderKey(path.relative(folder, b))
      ? -1
      : 1,
  );
  const index: BaseIndex = new Map();
  const unreadable: string[] = [];

  for (const archive of archives) {
    let entries;

    try {
      ({ entries } = await readArchiveIndexTable(archive));
    } catch {
      unreadable.push(path.relative(folder, archive));
      continue;
    }

    const own = new Map<string, BaseEntry>();

    for (const entry of entries) {
      own.set(entry.name.replace(/\\/g, '/').toLowerCase(), {
        archive,
        offset: entry.offset,
        size: entry.size,
      });
    }

    for (const [name, entry] of own) {
      if (!index.has(name)) {
        index.set(name, entry);
      }
    }
  }

  return { index, archives: archives.length, unreadable };
};

/** Reads a base game file */
export const readBaseEntry = async (entry: BaseEntry): Promise<Uint8Array> => {
  const file = await open(entry.archive, 'r');

  try {
    const bytes = Buffer.alloc(entry.size);
    const { bytesRead } = await file.read(bytes, 0, entry.size, entry.offset);

    return bytes.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
};

export type Change = 'added' | 'changed' | 'same';

export interface ModFile {
  entryPath: string;
  size: number;
  read: () => PromiseLike<Uint8Array>;
}

export interface ComparedFile {
  entryPath: string;
  change: Change;
  size: number;
  baseSize?: number;
}

const equalBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

/** Sorts each of the mod's files into added, changed or the same as the base game */
export const compareWithBase = async (
  files: ModFile[],
  base: BaseIndex,
  progress?: (done: number) => void,
): Promise<ComparedFile[]> => {
  const results: ComparedFile[] = [];

  for (const [done, file] of files.entries()) {
    const entry = base.get(file.entryPath.toLowerCase());

    if (!entry) {
      results.push({
        entryPath: file.entryPath,
        change: 'added',
        size: file.size,
      });
    } else if (entry.size !== file.size) {
      results.push({
        entryPath: file.entryPath,
        change: 'changed',
        size: file.size,
        baseSize: entry.size,
      });
    } else {
      const [mine, theirs] = await Promise.all([
        file.read(),
        readBaseEntry(entry),
      ]);

      results.push({
        entryPath: file.entryPath,
        change: equalBytes(mine, theirs) ? 'same' : 'changed',
        size: file.size,
        baseSize: entry.size,
      });
    }

    progress?.(done + 1);
  }

  return results;
};
