import * as vscode from 'vscode';
import { findBelow } from './findBelow';
import { clearFolderListings } from './folderListing';

/** Gets the movie name a geometry folder, `<movie>_geometry`, belongs to, or nothing for any other folder */
export const getGeometryMovieName = (ruUri: vscode.Uri): string | undefined =>
  /^(.+)_geometry$/i.exec(ruUri.path.split('/').slice(-2)[0] ?? '')?.[1];

/** Finds the `.apt` that owns a `<movie>_geometry/<n>.ru` file: the movie of that name beside the folder */
export const findGeometryMovie = async (
  ruUri: vscode.Uri,
): Promise<vscode.Uri | undefined> => {
  const movie = getGeometryMovieName(ruUri);

  clearFolderListings();
  return movie
    ? findBelow(
        vscode.Uri.joinPath(ruUri, '..', '..'),
        `${movie}.apt`,
        vscode.FileType.File,
      )
    : undefined;
};
