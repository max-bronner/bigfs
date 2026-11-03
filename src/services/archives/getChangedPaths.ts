import type { EntryChange } from './archive';

/**
 * Gets the entry paths a set of changes writes, removes, moves or copies, so a
 * listener can look at those entries instead of the whole archive. A path may
 * name a directory, which stands for everything below it. Creating a directory
 * touches no entry.
 */
export const getChangedPaths = (changes: readonly EntryChange[]): string[] =>
  changes.flatMap((change) => {
    switch (change.kind) {
      case 'addDirectory':
        return [];
      case 'move':
      case 'copy':
        return [change.from, change.to];
      default:
        return [change.path];
    }
  });
