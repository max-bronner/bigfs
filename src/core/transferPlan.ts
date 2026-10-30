import { getAvailableName, getParentPath } from './paths';

/**
 * Plans a transfer of files into a directory of another archive: which target
 * path each file takes once the user has said what a taken name means. Pure,
 * so the rules hold without an archive or an editor behind them.
 */

/** What the user chose for the files whose name is already taken */
export type ConflictChoice = 'replace' | 'skip' | 'keepBoth';

/** A file to transfer, named by its path below the target directory */
export interface TransferItem {
  path: string;
}

/** What the target directory holds, by path below it */
export interface TargetContent {
  files: Iterable<string>;
  directories: Iterable<string>;
}

/** One file of a plan: where it lands, and whether it overwrites a file there */
export interface PlannedTransfer<T extends TransferItem> {
  item: T;
  targetPath: string;
  replaces: boolean;
}

const key = (path: string): string => path.toLowerCase();

/**
 * Gets the items whose path is taken by a file in the target. A directory of
 * that name is not listed: it is never replaced, so there is nothing to ask.
 */
export const findConflicts = <T extends TransferItem>(
  items: readonly T[],
  target: TargetContent,
): T[] => {
  const files = new Set(Array.from(target.files, key));

  return items.filter((item) => files.has(key(item.path)));
};

/** Gets a path whose last segment no taken path uses, with a copy suffix */
const getFreePath = (path: string, taken: ReadonlySet<string>): string => {
  const parent = getParentPath(path);
  const name = path.slice(parent ? parent.length + 1 : 0);
  const siblings = Array.from(taken)
    .filter((each) => getParentPath(each) === key(parent))
    .map((each) => each.slice(parent ? parent.length + 1 : 0));
  const free = getAvailableName(siblings, name);

  return parent ? `${parent}/${free}` : free;
};

/**
 * Plans where each item lands. A taken name is replaced, skipped or kept
 * beside the existing file under a free name, as chosen. Names that clash
 * with a directory of the target, or with an item planned before them, are
 * always kept under a free name, since replacing would lose one of them.
 */
export const planTransfer = <T extends TransferItem>(
  items: readonly T[],
  target: TargetContent,
  choice: ConflictChoice,
): PlannedTransfer<T>[] => {
  const existingFiles = new Set(Array.from(target.files, key));
  const directories = new Set(Array.from(target.directories, key));
  const taken = new Set([...existingFiles, ...directories]);
  const planned: PlannedTransfer<T>[] = [];

  for (const item of items) {
    const itemKey = key(item.path);
    const clashesFile = existingFiles.has(itemKey);
    const mustRename =
      directories.has(itemKey) ||
      (taken.has(itemKey) && !clashesFile) ||
      (clashesFile && choice === 'keepBoth') ||
      planned.some((each) => key(each.targetPath) === itemKey);

    if (clashesFile && choice === 'skip') {
      continue;
    }

    if (mustRename) {
      const targetPath = getFreePath(item.path, taken);

      taken.add(key(targetPath));
      planned.push({ item, targetPath, replaces: false });
      continue;
    }

    taken.add(itemKey);
    planned.push({ item, targetPath: item.path, replaces: clashesFile });
  }

  return planned;
};
