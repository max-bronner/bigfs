import { readdir } from 'fs/promises';
import { Uri, workspace } from 'vscode';
import {
  detectInstallKind,
  isInsideSource,
  orderLayers,
} from '../../game/install/installLayers';
import type { InstallKind } from '../../game/install/installLayers';
import { findBaseGameFolders } from './baseGameFolders';

/**
 * A place archives come from. Today that is a folder of the workspace; later
 * it can be a folder added by hand, which is why an archive is identified by
 * its source and its path inside it rather than by the workspace.
 */
export interface ArchiveSource {
  /** First segment of every uri into this source, stable across sessions */
  readonly id: string;
  /** What the tree shows for the source */
  readonly label: string;
  readonly baseUri: Uri;
  /** Which game the folder holds, by its marker files; a mod when none is there */
  readonly kind: InstallKind;
  /** The base game folder, or a layer beneath it: the lowest the game view layers */
  readonly base: boolean;
  /** Outside the workspace, so archives are found by reading the folder rather than by the workspace search */
  readonly external: boolean;
}

/** Turns a folder name into a uri segment, named `source` when nothing is left */
const toSlug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'source';

/** Short and stable, only needed when two folders share a name */
const toSuffix = (text: string): string => {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36).slice(0, 6);
};

/** Names the game a folder holds from the files in it; a mod when it cannot be read */
const detectKind = async (folder: Uri): Promise<InstallKind> => {
  if (folder.scheme !== 'file') {
    return 'mod';
  }

  try {
    return detectInstallKind(await readdir(folder.fsPath));
  } catch {
    return 'mod';
  }
};

/**
 * Creates one source per workspace folder, so a multi root workspace keeps
 * its folders apart the way the explorer does, and one for each base game
 * folder the settings name that the workspace does not hold. They come in
 * the order the game layers them: a mod, then ROTWK, then BFME II, then a
 * base folder no marker file names. Folders of one kind keep their order in
 * the workspace, which is what decides between two mods.
 */
export const createSources = async (): Promise<ArchiveSource[]> => {
  const taken = new Set<string>();
  const workspaceFolders = workspace.workspaceFolders ?? [];
  const baseFolders = (await findBaseGameFolders()).map((folder) =>
    Uri.file(folder),
  );
  const unique = (name: string, fsPath: string) => {
    const slug = toSlug(name);
    const id = taken.has(slug) ? `${slug}-${toSuffix(fsPath)}` : slug;

    taken.add(id);

    return id;
  };
  const sameFolder = (a: Uri, b: Uri) =>
    a.fsPath.toLowerCase() === b.fsPath.toLowerCase();
  const sources: ArchiveSource[] = [];

  for (const folder of workspaceFolders) {
    sources.push({
      id: unique(folder.name, folder.uri.fsPath),
      label: folder.name,
      baseUri: folder.uri,
      kind: await detectKind(folder.uri),
      base: baseFolders.some((base) => sameFolder(base, folder.uri)),
      external: false,
    });
  }

  for (const folder of baseFolders) {
    // One already in the workspace is that source, and one below a workspace
    // folder is found by its scan
    if (
      workspaceFolders.some((held) =>
        isInsideSource(folder.fsPath, held.uri.fsPath),
      )
    ) {
      continue;
    }

    const name = folder.path.split('/').filter(Boolean).at(-1) ?? 'base game';

    sources.push({
      id: unique(`base-${name}`, folder.fsPath),
      label: `Base game: ${name}`,
      baseUri: folder,
      kind: await detectKind(folder),
      base: true,
      external: true,
    });
  }

  return orderLayers(sources);
};

/** Finds the source a file on disk belongs to, if one of them holds it */
export const findSourceFor = (
  sources: readonly ArchiveSource[],
  uri: Uri,
): ArchiveSource | undefined => {
  const wanted = uri.fsPath.toLowerCase();

  // The longest base wins, for a source nested inside another
  return sources
    .filter((source) => wanted.startsWith(source.baseUri.fsPath.toLowerCase()))
    .sort((a, b) => b.baseUri.fsPath.length - a.baseUri.fsPath.length)
    .at(0);
};

/**
 * Gets where an archive sits inside its source, which together with the
 * source id gives it a place of its own: two archives that share a name stay
 * apart because the folders holding them differ.
 */
export const getPathInSource = (source: ArchiveSource, uri: Uri): string =>
  uri.fsPath
    .slice(source.baseUri.fsPath.length)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
