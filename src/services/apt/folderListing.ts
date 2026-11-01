import * as vscode from 'vscode';

const listings = new Map<string, Promise<[string, vscode.FileType][]>>();

/** Lists a folder of the workspace or an archive; the listing is kept until `clearFolderListings`, and a folder that cannot be read lists as empty */
export const listFolder = (folder: vscode.Uri) => {
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

/** Forgets the kept listings, so the next read sees the folders as they are now */
export const clearFolderListings = (): void => listings.clear();
