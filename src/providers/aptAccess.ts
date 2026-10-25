import * as vscode from 'vscode';
import type { MovieAccess } from '../formats/apt/aptIntegrity';

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

/** A path below a folder, each step matched without casing */
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

      if (pending) {
        return pending;
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
      const names = new Set([
        ...(uri ? await listFolder(uri) : [])
          .filter(([, kind]) => kind & vscode.FileType.File)
          .map(([each]) => each),
        ...[...added.keys()]
          .filter((path) => path.toLowerCase().startsWith(prefix))
          .map((path) => path.slice(prefix.length))
          .filter((each) => !each.includes('/')),
      ]);

      return uri || names.size ? [...names] : undefined;
    },
  };
};
