import { open, readFile } from 'fs/promises';
import * as path from 'path';
import { scanInstalls } from './installScan';
import type { ScanOptions } from './installScan';
import type { BaseArchive } from './modPackage';

/**
 * The base game a mod is compared against: every file its installs give the
 * game, after the engine's order (inside one install loose files, then
 * archives sorted by path below it with the first holding a file winning,
 * inside one archive the last copy; installs layered, the first given
 * winning), read straight from the install folders, which need not be in
 * the workspace.
 */

export interface BaseEntry {
  /** The archive, or for a loose file the file itself */
  archive: string;
  offset: number;
  size: number;
  /** A file on disk rather than an archive entry */
  loose?: boolean;
}

/** Lowercased, '/' separated entry path to where the base game keeps it */
export type BaseIndex = Map<string, BaseEntry>;

/**
 * Reads every install given, highest layer first, into one index: the first
 * file seen at a path is the one the game loads
 */
export const indexBaseGame = async (
  folders: string | readonly string[],
  options: ScanOptions = {},
): Promise<{ index: BaseIndex; archives: number; unreadable: string[] }> => {
  const layers = typeof folders === 'string' ? [folders] : folders;
  const { installs, files } = await scanInstalls(layers, options);
  const index: BaseIndex = new Map();

  for (const { entryPath, ref } of files) {
    const key = entryPath.toLowerCase();

    if (!index.has(key)) {
      index.set(
        key,
        ref.kind === 'loose'
          ? { archive: ref.path, offset: 0, size: ref.size, loose: true }
          : { archive: ref.path, offset: ref.offset, size: ref.size },
      );
    }
  }

  return {
    index,
    archives: installs.reduce(
      (sum, { archives, unreadable }) =>
        sum + archives.length + unreadable.length,
      0,
    ),
    unreadable: installs.flatMap(({ folder, unreadable }) =>
      unreadable.map((each) =>
        layers.length > 1 ? `${path.basename(folder)}/${each}` : each,
      ),
    ),
  };
};

/**
 * Every archive of the installs with the files it holds, by path below its
 * install, and each install's loose files as one entry of their own
 */
export const listBaseArchives = async (
  folders: string | readonly string[],
  options: ScanOptions = {},
): Promise<{ archives: BaseArchive[]; unreadable: string[] }> => {
  const layers = typeof folders === 'string' ? [folders] : folders;
  const { installs } = await scanInstalls(layers, options);
  const archives: BaseArchive[] = [];

  installs.forEach((install, layer) => {
    if (install.loose.length) {
      archives.push({
        path: `${path.basename(install.folder)} (loose files)`,
        layer,
        loose: true,
        entries: new Set(
          install.loose.map((file) => file.entryPath.toLowerCase()),
        ),
      });
    }

    for (const archive of install.archives) {
      archives.push({
        path: archive.pathInInstall,
        layer,
        entries: new Set(
          archive.files.map((file) => file.entryPath.toLowerCase()),
        ),
      });
    }
  });

  return {
    archives,
    unreadable: installs.flatMap((install) => install.unreadable),
  };
};

/** Reads a base game file */
export const readBaseEntry = async (entry: BaseEntry): Promise<Uint8Array> => {
  if (entry.loose) {
    return readFile(entry.archive);
  }

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
  isCancelled: () => boolean = () => false,
): Promise<ComparedFile[]> => {
  const results: ComparedFile[] = [];

  for (const [done, file] of files.entries()) {
    if (isCancelled()) {
      break;
    }

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
