/**
 * The game's view of a set of installs: for every path, only the file the
 * engine loads, with the copies it ignores recorded under it.
 *
 * The rules are the engine's (mint's `crates/sage/big/src/lib.rs`, from
 * Generals' `Win32BIGFileSystem.cpp` and `ArchiveFileSystem.cpp`):
 *
 * - Inside one install, archives are taken in order of their path below the
 *   install, compared without casing, `\` between folders. The first archive
 *   holding a path wins, which is why `___test.big` overrides `INI.big`.
 * - Loose files of an install beat every archive of it.
 * - Several installs are layered in the order given, the first winning: put
 *   the expansion or the mod before the base game.
 */

/** One place a path can come from, in a layer */
export interface GameFile<T> {
  /** Archive relative, '/' separated: `data/ini/object.ini` */
  entryPath: string;
  /** Whatever the caller needs to open the file */
  ref: T;
  /** Where it comes from, as a row's description shows it */
  origin: string;
}

/** A path in the game view: a directory, or the file the game loads */
export interface GameNode<T> {
  /** As the winning copy stores it */
  name: string;
  /** Lowercased, '/' separated; empty for the root */
  path: string;
  children?: Map<string, GameNode<T>>;
  /** For a file: the copy the game loads */
  winner?: GameFile<T>;
  /** For a file: the copies it ignores, highest priority first */
  shadowed?: GameFile<T>[];
}

/**
 * The key the engine orders an install's archives by: the path below the
 * install, lowercased, with backslashes
 */
export const archiveOrderKey = (pathInInstall: string): string =>
  pathInInstall.toLowerCase().replace(/\//g, '\\');

/**
 * Builds the game view from candidate files, highest priority first: the
 * first file seen at a path wins, every later one is recorded as shadowed.
 */
export const buildGameTree = <T>(files: Iterable<GameFile<T>>): GameNode<T> => {
  const root: GameNode<T> = { name: '', path: '', children: new Map() };

  for (const file of files) {
    const segments = file.entryPath.split('/').filter(Boolean);
    let node: GameNode<T> | undefined = root;

    for (const [index, segment] of segments.entries()) {
      const key = segment.toLowerCase();
      const isLeaf = index === segments.length - 1;
      let child: GameNode<T> | undefined = node.children?.get(key);

      if (!child) {
        child = {
          name: segment,
          path: node.path ? `${node.path}/${key}` : key,
          ...(isLeaf ? {} : { children: new Map() }),
        };
        node.children?.set(key, child);
      }

      // A file and a directory cannot share a path; the earlier one keeps it
      if (isLeaf === Boolean(child.children)) {
        node = undefined;
        break;
      }

      node = child;
    }

    if (!node || node === root) {
      continue;
    }

    if (node.winner) {
      node.shadowed = [...(node.shadowed ?? []), file];
    } else {
      node.winner = file;
    }
  }

  return root;
};

/** Every file at or below a node, in path order */
export const getGameFiles = <T>(node: GameNode<T>): GameNode<T>[] =>
  node.children
    ? Array.from(node.children.values()).flatMap(getGameFiles)
    : node.winner
      ? [node]
      : [];
