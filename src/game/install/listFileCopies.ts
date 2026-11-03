import { getGameFiles } from './gameView';
import type { GameFile, GameNode } from './gameView';

/** One copy of a path in the game view, with whether the game loads it */
export interface FileCopy<T> {
  /** The file name as the copy stores it */
  name: string;
  /** Archive relative, '/' separated, as the copy stores it */
  entryPath: string;
  /** Whatever the caller needs to open the copy */
  ref: T;
  /** Where the copy comes from, as an explorer row shows it */
  origin: string;
  /** Whether the game loads this copy rather than ignoring it */
  isLoaded: boolean;
  /** How many copies of the path the game view holds, this one included */
  copies: number;
  /** For a copy the game ignores: where the copy it loads comes from */
  loadedFrom?: string;
}

/** Gets the file name of an entry path */
const getFileName = (entryPath: string): string =>
  entryPath.slice(entryPath.lastIndexOf('/') + 1);

/**
 * Lists every copy of every file in the game view, the one the game loads
 * first and the copies it ignores after it, so a search can offer each of
 * them and say which one counts
 */
export const listFileCopies = <T>(root: GameNode<T>): FileCopy<T>[] =>
  getGameFiles(root).flatMap((node) => {
    const winner = node.winner as GameFile<T>;
    const toCopy = (file: GameFile<T>, isLoaded: boolean): FileCopy<T> => ({
      name: getFileName(file.entryPath),
      entryPath: file.entryPath,
      ref: file.ref,
      origin: file.origin,
      isLoaded,
      copies: (node.shadowed?.length ?? 0) + 1,
      ...(isLoaded ? {} : { loadedFrom: winner.origin }),
    });

    return [
      toCopy(winner, true),
      ...(node.shadowed ?? []).map((file) => toCopy(file, false)),
    ];
  });
