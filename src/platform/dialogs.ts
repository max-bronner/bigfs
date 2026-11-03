import { window } from 'vscode';
import { validateEntryName } from '../core/entryName';
import type { ConflictChoice } from '../core/transferPlan';

const MAX_LISTED_NAMES = 5;

const REPLACE_LABEL = 'Replace';
const SKIP_LABEL = 'Skip';
const KEEP_BOTH_LABEL = 'Keep Both';
const DELETE_LABEL = 'Delete';

type OverwriteChoice = 'replace' | 'skip' | 'cancel';

/**
 * Options of the name input box `askForName` shows: its title, the names the
 * answer must not collide with, and the name being changed when this is a rename
 */
export interface NamePrompt {
  title: string;
  /** The names already in use here, matched case insensitively */
  takenNames: Set<string>;
  /** The name being changed, which does not count as taken */
  currentName?: string;
  /**
   * Turns what was typed into the name it stands for, or says why it cannot;
   * entry names are checked by `validateEntryName` when this is left out
   */
  normalizeName?: (input: string) => { name: string } | { error: string };
}

/** Asks for a node name and validates it against its future siblings */
export const askForName = async (
  prompt: NamePrompt,
): Promise<string | undefined> => {
  const takenKeys = new Set(
    Array.from(prompt.takenNames, (takenName) => takenName.toLowerCase()),
  );
  const currentKey = prompt.currentName?.toLowerCase();

  const normalize =
    prompt.normalizeName ??
    ((input: string) => {
      const name = input.trim();
      const error = validateEntryName(name);

      return error ? { error } : { name };
    });

  const validateName = (input: string): string | undefined => {
    const result = normalize(input);

    if ('error' in result) {
      return result.error;
    }

    const key = result.name.toLowerCase();

    return key !== currentKey && takenKeys.has(key)
      ? `${result.name} already exists here.`
      : undefined;
  };

  const input = await window.showInputBox({
    title: prompt.title,
    value: prompt.currentName,
    validateInput: validateName,
  });

  if (input === undefined) {
    return undefined;
  }

  const result = normalize(input);

  return 'name' in result ? result.name : undefined;
};

/** Joins names for a dialog detail, counting off whatever does not fit */
const formatNameList = (names: string[]): string => {
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
    { modal: true, detail: formatNameList(names) },
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
    { modal: true, detail: formatNameList(names) },
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

/** Asks whether archives should be moved to the trash, off the disk */
export const confirmDeleteArchives = async (
  names: string[],
): Promise<boolean> => {
  const subject =
    names.length === 1 ? 'this archive' : `these ${names.length} archives`;

  const selectedOption = await window.showWarningMessage(
    `Move ${subject} to the trash?`,
    { modal: true, detail: formatNameList(names) },
    DELETE_LABEL,
  );

  return selectedOption === DELETE_LABEL;
};

/** Asks whether the items should be removed from the archive for good */
export const confirmDelete = async (names: string[]): Promise<boolean> => {
  const subject =
    names.length === 1 ? 'this item' : `these ${names.length} items`;

  const selectedOption = await window.showWarningMessage(
    `Permanently delete ${subject} from the archive?`,
    { modal: true, detail: formatNameList(names) },
    DELETE_LABEL,
  );

  return selectedOption === DELETE_LABEL;
};
