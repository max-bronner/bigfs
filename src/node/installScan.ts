import { readdir, stat } from 'fs/promises';
import * as path from 'path';
import { readArchiveIndexTable } from './archiveFile';
import { orderInstallFiles } from '../game/install/gameView';
import type { GameFile, InstallFiles } from '../game/install/gameView';

/**
 * Reads an install folder from disk the way the game finds its files: the
 * loose files below its top folders and every archive's index table. Needs
 * no editor, so a base game outside the workspace can be read with it.
 */

/**
 * The folders an install keeps its files in, which loose files are looked
 * for under besides whatever folders its archives hold
 */
export const GAME_FOLDERS: readonly string[] = [
  'data',
  'art',
  'maps',
  'ui',
  'shaders',
  'libraries',
  'scripts',
  'lang',
  'audio',
  'sounds',
  'movies',
  'fonts',
];

const MAX_DEPTH = 8;
const MAX_LOOSE_DEPTH = 24;

/** Where a scanned file is, to read it */
export type ScanRef =
  | { kind: 'loose'; path: string; size: number }
  | { kind: 'archive'; path: string; offset: number; size: number };

export type ScanFile = GameFile<ScanRef>;

/** Every archive below a folder, found by extension at any depth up to eight */
export const findArchives = async (
  folder: string,
  depth = 0,
): Promise<string[]> => {
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

/**
 * Entry paths, '/' separated and as written on disk, of the files loose below
 * the named top folders of an install. Folders are matched without casing;
 * hidden folders and archives are left out.
 */
export const listLooseFiles = async (
  root: string,
  folders: Iterable<string>,
): Promise<string[]> => {
  const wanted = new Set(Array.from(folders, (name) => name.toLowerCase()));
  const found: string[] = [];

  const walk = async (directory: string, relative: string, depth: number) => {
    let entries;

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return; // a folder that does not read holds nothing to find
    }

    for (const entry of entries) {
      const entryPath = relative ? `${relative}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (
          !entry.name.startsWith('.') &&
          depth < MAX_LOOSE_DEPTH &&
          (relative || wanted.has(entry.name.toLowerCase()))
        ) {
          await walk(path.join(directory, entry.name), entryPath, depth + 1);
        }
      } else if (
        relative &&
        entry.isFile() &&
        !entry.name.startsWith('.') &&
        !/\.big$/i.test(entry.name)
      ) {
        found.push(entryPath);
      }
    }
  };

  await walk(root, '', 0);

  return found;
};

/** One install: its loose files and its archives, each with the files it holds */
export interface ScannedInstall extends InstallFiles<ScanRef> {
  folder: string;
  unreadable: string[];
}

/** What a scan leaves out */
export interface ScanOptions {
  /** Archives to ignore, by lowercased path on disk: what bigFS packed itself */
  exclude?: ReadonlySet<string>;
}

/** Reads the loose files and archive index tables of an install folder */
export const scanInstall = async (
  folder: string,
  label = path.basename(folder),
  { exclude }: ScanOptions = {},
): Promise<ScannedInstall> => {
  const archives: ScannedInstall['archives'] = [];
  const unreadable: string[] = [];
  const topFolders = new Set(GAME_FOLDERS);

  for (const archive of await findArchives(folder)) {
    if (exclude?.has(archive.toLowerCase())) {
      continue;
    }

    const pathInInstall = path.relative(folder, archive).replace(/\\/g, '/');
    let entries;

    try {
      ({ entries } = await readArchiveIndexTable(archive));
    } catch {
      unreadable.push(pathInInstall);
      continue;
    }

    // An archive that repeats a path gives the game the last copy
    const own = new Map<string, ScanFile>();

    for (const entry of entries) {
      const entryPath = entry.name.replace(/\\/g, '/');

      topFolders.add(entryPath.split('/')[0].toLowerCase());
      own.set(entryPath.toLowerCase(), {
        entryPath,
        origin: `${label}: ${pathInInstall}`,
        ref: {
          kind: 'archive',
          path: archive,
          offset: entry.offset,
          size: entry.size,
        },
      });
    }

    archives.push({ pathInInstall, files: [...own.values()] });
  }

  const loose: ScanFile[] = [];

  for (const entryPath of await listLooseFiles(folder, topFolders)) {
    const file = path.join(folder, ...entryPath.split('/'));

    try {
      loose.push({
        entryPath,
        origin: `${label} (loose)`,
        ref: { kind: 'loose', path: file, size: (await stat(file)).size },
      });
    } catch {
      continue; // gone since the listing
    }
  }

  return { folder, loose, archives, unreadable };
};

/**
 * Reads installs given highest layer first, and orders everything they give
 * the game, the file to take first
 */
export const scanInstalls = async (
  folders: readonly string[],
  options: ScanOptions = {},
): Promise<{ installs: ScannedInstall[]; files: ScanFile[] }> => {
  const installs: ScannedInstall[] = [];

  for (const folder of folders) {
    installs.push(await scanInstall(folder, undefined, options));
  }

  return { installs, files: orderInstallFiles(installs) };
};
