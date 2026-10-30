import * as vscode from 'vscode';
import type { MovieAccess } from '../../formats/apt/aptIntegrity';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import { getNodeUri } from '../../services/archives/nodeAddress';
import { getFileNodes } from '../../services/archives/virtualNode';

/**
 * The files beside a movie as the game finds them: by path relative to the
 * movie's folder, without casing, and nowhere else. A check reads through
 * this rather than searching other archives, which would hide exactly the
 * missing file it is looking for. Files an unsaved edit added count, as
 * they will be there once it is saved.
 */

const listings = new Map<string, Promise<[string, vscode.FileType][]>>();

const listFolder = (folder: vscode.Uri) => {
  const key = folder.toString();
  let listing = listings.get(key);

  if (!listing) {
    listing = Promise.resolve(vscode.workspace.fs.readDirectory(folder)).catch(
      () => [],
    );
    listings.set(key, listing);
  }
  return listing;
};

/** Finds a path below a folder, each step matched without casing */
const findBelow = async (
  folder: vscode.Uri,
  relative: string,
  type: vscode.FileType,
): Promise<vscode.Uri | undefined> => {
  const steps = relative.split('/').filter(Boolean);
  let at = folder;

  for (const [index, step] of steps.entries()) {
    const wanted =
      index === steps.length - 1 ? type : vscode.FileType.Directory;
    const match = (await listFolder(at)).find(
      ([name, kind]) =>
        name.toLowerCase() === step.toLowerCase() && (kind & wanted) !== 0,
    );

    if (!match) {
      return undefined;
    }
    at = vscode.Uri.joinPath(at, match[0]);
  }
  return at;
};

/**
 * Creates the `MovieAccess` an integrity check reads a movie's neighbours
 * through. `added` holds an unsaved edit's files; an empty one marks a removal.
 */
export const movieAccess = (
  aptUri: vscode.Uri,
  name: string,
  apt: Uint8Array,
  added: Map<string, Uint8Array> = new Map(),
): MovieAccess => {
  const folder = vscode.Uri.joinPath(aptUri, '..');
  const addedByLower = new Map(
    [...added].map(([path, bytes]) => [path.toLowerCase(), bytes]),
  );

  // Each check sees the folder as it is now
  listings.clear();

  return {
    name,
    apt,
    async read(relative) {
      const pending = addedByLower.get(relative.toLowerCase());

      // An empty one was removed by an edit
      if (pending) {
        return pending.length ? pending : undefined;
      }

      const uri = await findBelow(folder, relative, vscode.FileType.File);

      return uri
        ? Promise.resolve(vscode.workspace.fs.readFile(uri)).catch(
            () => undefined,
          )
        : undefined;
    },
    async list(relative) {
      const uri = await findBelow(folder, relative, vscode.FileType.Directory);
      const prefix = relative.toLowerCase() + '/';
      const removed = new Set(
        [...added]
          .filter(
            ([path, bytes]) =>
              !bytes.length && path.toLowerCase().startsWith(prefix),
          )
          .map(([path]) => path.slice(prefix.length).toLowerCase()),
      );
      const names = new Set([
        ...(uri ? await listFolder(uri) : [])
          .filter(([, kind]) => kind & vscode.FileType.File)
          .map(([each]) => each),
        ...[...added.keys()]
          .filter((path) => path.toLowerCase().startsWith(prefix))
          .map((path) => path.slice(prefix.length))
          .filter((each) => !each.includes('/')),
      ]);

      const left = [...names].filter(
        (each) => !removed.has(each.toLowerCase()),
      );

      return uri || left.length ? left : undefined;
    },
  };
};

/** Finds every `.apt` of the workspace, loose and inside archives */
export const workspaceMovies = async (
  archiveModel: ArchiveModel,
): Promise<vscode.Uri[]> => {
  await archiveModel.whenReady();

  const movies = await vscode.workspace.findFiles(
    '**/*.{apt,APT}',
    '**/node_modules/**',
  );

  for (const archive of archiveModel.getArchiveRoots()) {
    try {
      await archiveModel.loadArchiveOf(archive);
    } catch {
      continue; // an archive that does not read holds no movie
    }
    movies.push(
      ...getFileNodes(archive)
        .filter((node) => /\.apt$/i.test(node.name))
        .map(getNodeUri),
    );
  }
  return movies;
};

/** Finds a file or folder beside a movie, matched without casing */
export const findBeside = (
  aptUri: vscode.Uri,
  relative: string,
  type: vscode.FileType,
): Promise<vscode.Uri | undefined> => {
  listings.clear();
  return findBelow(vscode.Uri.joinPath(aptUri, '..'), relative, type);
};

/** Lists the names in a folder beside a movie, found without casing */
export const listBeside = async (
  aptUri: vscode.Uri,
  relative: string,
): Promise<[string, vscode.FileType][]> => {
  const folder = await findBeside(aptUri, relative, vscode.FileType.Directory);

  return folder ? listFolder(folder) : [];
};
