/**
 * Rules for the names and paths of archive entries. Pure, so a prompt, a drop
 * and the file system provider all refuse the same things.
 */

/**
 * Longest entry path accepted, in characters. Retail archives top out at 99
 * bytes and mint's reader refuses names past 1024; this stays well inside
 * both, and inside the 260 characters a Windows path holds once extracted.
 */
export const MAX_ENTRY_PATH_LENGTH = 255;

/** Device names Windows reserves, which an entry could not be extracted under */
const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Characters Windows forbids in a file name, plus the control characters */
const FORBIDDEN_CHARACTERS = /[<>:"|?*\u0000-\u001f]/;

/**
 * Characters the index table cannot store: it holds one byte per character,
 * and the byte range 0x7F-0x9F is control characters in the games' encoding
 */
const UNSTORABLE_CHARACTER = /[^ -~ -ÿ]/;

/**
 * Checks one name, the last segment of an entry path.
 * @returns why the name is refused, or undefined when it is fine
 */
export const validateEntryName = (name: string): string | undefined => {
  if (!name.trim()) {
    return 'A name is required.';
  }

  if (/[\\/]/.test(name)) {
    return 'A name cannot contain a path separator.';
  }

  if (name === '.' || name === '..') {
    return `${name} is not a valid name.`;
  }

  if (name !== name.trim()) {
    return 'A name cannot start or end with a space.';
  }

  if (name.endsWith('.')) {
    return 'A name cannot end with a dot.';
  }

  if (FORBIDDEN_CHARACTERS.test(name)) {
    return 'A name cannot contain < > : " | ? * or control characters.';
  }

  if (RESERVED_DEVICE_NAMES.test(name.split('.')[0])) {
    return `${name.split('.')[0]} is a reserved name on Windows.`;
  }

  if (UNSTORABLE_CHARACTER.test(name)) {
    return 'A name can only hold Windows-1252 characters: the archive stores one byte per character.';
  }

  return undefined;
};

/**
 * Checks a whole entry path written with either separator, as an import or a
 * drop produces it.
 * @returns why the path is refused, or undefined when it is fine
 */
export const validateEntryPath = (entryPath: string): string | undefined => {
  if (!entryPath) {
    return 'A path is required.';
  }

  if (/^[\\/]|[\\/]$/.test(entryPath)) {
    return 'A path cannot start or end with a separator.';
  }

  if (entryPath.length > MAX_ENTRY_PATH_LENGTH) {
    return `A path can hold at most ${MAX_ENTRY_PATH_LENGTH} characters.`;
  }

  for (const segment of entryPath.split(/[\\/]/)) {
    const problem = segment ? validateEntryName(segment) : 'A path cannot hold an empty segment.';

    if (problem) {
      return problem;
    }
  }

  return undefined;
};

/** A path that cannot be added, with the reason */
export interface PathProblem {
  path: string;
  reason: string;
}

/**
 * Finds the paths that cannot stand beside the others in one archive: a path
 * repeated, or a file whose path another path needs as a directory. Case is
 * ignored, as the archive does. The first path to claim a name keeps it.
 */
export const findPathClashes = (paths: readonly string[]): PathProblem[] => {
  const files = new Set<string>();
  const directories = new Set<string>();
  const clashes: PathProblem[] = [];

  for (const entryPath of paths) {
    const segments = entryPath.toLowerCase().split('/');
    const key = segments.join('/');
    const parents = segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
    const blocker = parents.find((parent) => files.has(parent));

    if (files.has(key)) {
      clashes.push({ path: entryPath, reason: 'The same path is added twice.' });
    } else if (directories.has(key)) {
      clashes.push({ path: entryPath, reason: 'A folder of that name exists.' });
    } else if (blocker) {
      clashes.push({ path: entryPath, reason: `${blocker} is a file, not a folder.` });
    } else {
      files.add(key);
      parents.forEach((parent) => directories.add(parent));
    }
  }

  return clashes;
};

/** Why a node cannot move into a directory */
export type MoveRefusal = 'itself' | 'inside' | 'sameFolder';

/**
 * Checks a move of an entry path into a directory path of one archive.
 * Paths compare without regard to case.
 */
export const getMoveRefusal = (
  sourcePath: string,
  targetDirectoryPath: string,
): MoveRefusal | undefined => {
  const source = sourcePath.toLowerCase();
  const target = targetDirectoryPath.toLowerCase();

  if (source === target) {
    return 'itself';
  }

  if (target.startsWith(`${source}/`)) {
    return 'inside';
  }

  const separator = source.lastIndexOf('/');

  return (separator < 0 ? '' : source.slice(0, separator)) === target ? 'sameFolder' : undefined;
};

/**
 * Turns what the user typed for a new archive into its file name: the `.big`
 * extension is added when missing, and the name must be a valid file name.
 * @returns the file name, or why it is refused
 */
export const toArchiveFileName = (
  input: string,
): { name: string } | { error: string } => {
  const typed = input.trim();
  const name = /\.big$/i.test(typed) ? typed : `${typed}.big`;
  const stem = name.slice(0, -4);

  if (!stem) {
    return { error: 'A name is required.' };
  }

  const problem = validateEntryName(name);

  return problem ? { error: problem } : { name };
};
