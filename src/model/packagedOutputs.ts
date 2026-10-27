/**
 * The archives bigFS packed itself. They are the mod's, wherever the user
 * saved them, so a comparison against the base game leaves them out even
 * when one was saved into the base game folder.
 */

/** The part of a VS Code `Memento` this needs */
export interface OutputStore {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

const KEY = 'bigfs.packedArchives';

/** Lowercased paths, so a lookup does not depend on how the path was typed */
const outputs = new Set<string>();
let store: OutputStore | undefined;

/** Starts remembering across sessions, and takes in what was remembered */
export const useOutputStore = (given: OutputStore): void => {
  store = given;
  given.get<string[]>(KEY, []).forEach((each) => outputs.add(each));
};

export const recordPackedArchive = (archivePath: string): void => {
  outputs.add(archivePath.toLowerCase());
  void store?.update(KEY, [...outputs]);
};

/** Archives to leave out of the base game, by lowercased path */
export const packedArchives = (): ReadonlySet<string> => outputs;
