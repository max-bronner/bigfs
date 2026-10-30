import { window } from 'vscode';
import type { ConflictChoice } from '../game/install/transferPlan';

const MAX_LISTED_NAMES = 5;

const REPLACE_LABEL = 'Replace';
const SKIP_LABEL = 'Skip';
const KEEP_BOTH_LABEL = 'Keep Both';
const DELETE_LABEL = 'Delete';

const SEPARATOR_PATTERN = /[\\/]/;

type OverwriteChoice = 'replace' | 'skip' | 'cancel';

/**
 * What an input box asks for: its title, the names the answer must not collide
 * with, and the name being changed when this is a rename
 */
export interface NamePrompt {
  title: string;
  /** The names already in use here, matched case insensitively */
  takenNames: Set<string>;
  /** The name being changed, which does not count as taken */
  currentName?: string;
}

/** Asks for a node name and validates it against its future siblings */
export const askForName = async (
  prompt: NamePrompt,
): Promise<string | undefined> => {
  const takenKeys = new Set(
    Array.from(prompt.takenNames, (takenName) => takenName.toLowerCase()),
  );
  const currentKey = prompt.currentName?.toLowerCase();

  const validateName = (input: string): string | undefined => {
    const name = input.trim();

    if (!name) {
      return 'A name is required.';
    }

    if (SEPARATOR_PATTERN.test(name)) {
      return 'A name cannot contain a path separator.';
    }

    const key = name.toLowerCase();

    if (key !== currentKey && takenKeys.has(key)) {
      return `${name} already exists here.`;
    }

    return undefined;
  };

  const name = await window.showInputBox({
    title: prompt.title,
    value: prompt.currentName,
    validateInput: validateName,
  });

  return name?.trim();
};

/** Joins names for a dialog detail, counting off whatever does not fit */
const getListedNames = (names: string[]): string => {
  const listedNames = names.slice(0, MAX_LISTED_NAMES);
  const hiddenCount = names.length - listedNames.length;

  if (hiddenCount) {
    listedNames.push(`and ${hiddenCount} more`);
  }

  return listedNames.join(', ');
};

/**
 * Asks whether the items already there should be replaced or skipped;
 * dismissing the dialog cancels
 */
const askForOverwrite = async (names: string[]): Promise<OverwriteChoice> => {
  const subject =
    names.length === 1 ? 'item already exists' : 'items already exist';

  const selectedOption = await window.showWarningMessage(
    `${names.length} ${subject} here.`,
    { modal: true, detail: getListedNames(names) },
    REPLACE_LABEL,
    SKIP_LABEL,
  );

  switch (selectedOption) {
    case REPLACE_LABEL:
      return 'replace';
    case SKIP_LABEL:
      return 'skip';
    default:
      return 'cancel';
  }
};

/**
 * Asks what to do with the files whose names are taken in the target:
 * replace them, skip them or keep both under a free name; dismissing the
 * dialog cancels the transfer
 */
export const askForTransferConflict = async (
  names: string[],
): Promise<ConflictChoice | undefined> => {
  const subject =
    names.length === 1 ? 'file already exists' : 'files already exist';

  const selectedOption = await window.showWarningMessage(
    `${names.length} ${subject} in the target.`,
    { modal: true, detail: getListedNames(names) },
    REPLACE_LABEL,
    SKIP_LABEL,
    KEEP_BOTH_LABEL,
  );

  switch (selectedOption) {
    case REPLACE_LABEL:
      return 'replace';
    case SKIP_LABEL:
      return 'skip';
    case KEEP_BOTH_LABEL:
      return 'keepBoth';
    default:
      return undefined;
  }
};

/**
 * Lets the user replace or skip the conflicting items, or cancel altogether.
 * Gives back the items to act on: all of them when nothing conflicts, none
 * when the user cancels
 */
export const resolveConflicts = async <T extends { name: string }>(
  items: T[],
  isConflicting: (item: T) => boolean,
): Promise<T[]> => {
  const conflictingItems = items.filter(isConflicting);

  if (!conflictingItems.length) {
    return items;
  }

  const conflictingItemNames = conflictingItems.map((item) => item.name);

  switch (await askForOverwrite(conflictingItemNames)) {
    case 'replace':
      return items;
    case 'skip':
      return items.filter((item) => !isConflicting(item));
    default:
      return [];
  }
};

/** Asks whether the items should be removed from the archive for good */
export const confirmDelete = async (names: string[]): Promise<boolean> => {
  const subject =
    names.length === 1 ? 'this item' : `these ${names.length} items`;

  const selectedOption = await window.showWarningMessage(
    `Permanently delete ${subject} from the archive?`,
    { modal: true, detail: getListedNames(names) },
    DELETE_LABEL,
  );

  return selectedOption === DELETE_LABEL;
};
