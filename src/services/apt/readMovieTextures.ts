import * as vscode from 'vscode';
import { decodeWindows1252 } from '../../core/windows1252';
import { getImageTextures } from '../../formats/apt/aptTextureUses';
import { parseDat } from '../../formats/apt/aptGeometry';
import { parseAptMovie, parseConst } from '../../formats/apt/aptMovie';
import type { Character } from '../../formats/apt/aptMovie';
import { clearFolderListings } from './folderListing';
import { findBelow } from './findBelow';

/** What a movie's `.dat` makes of its images: the texture file each one is drawn from */
export interface MovieTextures {
  name: string;
  /** The folder or archive the movie sits in; its geometry and `.dat` are read from there */
  folder: vscode.Uri;
  characters: readonly Character[];
  /** Image character to texture path */
  imageTextures: ReadonlyMap<number, string>;
}

/** Reads a file beside a movie, matched without casing, or nothing when it is absent or unreadable */
export const readBesideMovie = async (
  folder: vscode.Uri,
  relative: string,
): Promise<Uint8Array | undefined> => {
  const found = await findBelow(folder, relative, vscode.FileType.File);

  if (!found) {
    return undefined;
  }
  try {
    return await vscode.workspace.fs.readFile(found);
  } catch {
    return undefined;
  }
};

/**
 * Reads the characters of a movie and the texture each image is drawn from:
 * the `.apt`, the `.const` that locates its movie record, and the `.dat`.
 * Nothing when one is missing or does not parse, so a caller treats a movie it
 * cannot read as one with no regions.
 */
export const readMovieTextures = async (
  aptUri: vscode.Uri,
): Promise<MovieTextures | undefined> => {
  const name = aptUri.path
    .slice(aptUri.path.lastIndexOf('/') + 1)
    .replace(/\.apt$/i, '');
  const folder = vscode.Uri.joinPath(aptUri, '..');

  clearFolderListings();

  try {
    const [apt, constBytes, datBytes] = await Promise.all([
      vscode.workspace.fs.readFile(aptUri),
      readBesideMovie(folder, `${name}.const`),
      readBesideMovie(folder, `${name}.dat`),
    ]);

    if (!constBytes || !datBytes) {
      return undefined;
    }

    const { characters } = parseAptMovie(apt, parseConst(constBytes).movieOffset);

    return {
      name,
      folder,
      characters,
      imageTextures: getImageTextures(
        name,
        characters,
        parseDat(decodeWindows1252(datBytes)),
      ),
    };
  } catch {
    return undefined;
  }
};
