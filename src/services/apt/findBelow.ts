import * as vscode from 'vscode';
import { listFolder } from './folderListing';

/** Finds a path below a folder, each step matched without casing */
export const findBelow = async (
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
