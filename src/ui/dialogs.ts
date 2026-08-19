import { window } from 'vscode';

const MAX_LISTED_NAMES = 5;

const REPLACE_LABEL = 'Replace';
const SKIP_LABEL = 'Skip';
const DELETE_LABEL = 'Delete';

const SEPARATOR_PATTERN = /[\\/]/;

type OverwriteChoice = 'replace' | 'skip' | 'cancel';

export interface NamePrompt {
  title: string;
  takenNames: Set<string>;
  currentName?: string;
}

/**
 * Asks for a node name and validates it against its future siblings
 */
export const askForName = async (
  prompt: NamePrompt,
): Promise<string | undefined> => {
  const validateName = (input: string): string | undefined => {
    const name = input.trim();

    if (!name) {
      return 'A name is required.';
    }

    if (SEPARATOR_PATTERN.test(name)) {
      return 'A name cannot contain a path separator.';
    }

    if (name !== prompt.currentName && prompt.takenNames.has(name)) {
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

const getListedNames = (names: string[]): string => {
  const listedNames = names.slice(0, MAX_LISTED_NAMES);
  const hiddenCount = names.length - listedNames.length;

  if (hiddenCount) {
    listedNames.push(`and ${hiddenCount} more`);
  }

  return listedNames.join(', ');
};

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
 * Lets the user replace or skip the conflicting items, or cancel altogether
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

/**
 * Asks for confirmation before items are removed from an archive
 */
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
