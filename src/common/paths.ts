import path from 'path';

/**
 * Helpers for the '/' separated paths.
 */

/**
 * Gets the parent path, or an empty string for a path without a parent
 */
export const getParentPath = (nodePath: string): string => {
  const separatorIndex = nodePath.lastIndexOf('/');

  return separatorIndex < 0 ? '' : nodePath.slice(0, separatorIndex);
};

/**
 * Splits a path into its non-empty segments
 */
export const splitPath = (nodePath: string): string[] =>
  nodePath.split('/').filter((segment) => segment.length);

/**
 * Whether a path is another path or sits below it
 */
export const isPathBelow = (nodePath: string, ancestorPath: string): boolean =>
  nodePath === ancestorPath || nodePath.startsWith(`${ancestorPath}/`);

/**
 * Repoints a path from below one entry to below another
 */
export const movePath = (
  nodePath: string,
  sourcePath: string,
  targetPath: string,
): string =>
  nodePath === sourcePath
    ? targetPath
    : `${targetPath}${nodePath.slice(sourcePath.length)}`;

/**
 * Finds a name that is not taken yet by appending a copy suffix
 */
export const getAvailableName = (
  takenNames: Set<string>,
  name: string,
): string => {
  if (!takenNames.has(name)) {
    return name;
  }

  const extension = path.posix.extname(name);
  const baseName = name.slice(0, name.length - extension.length);

  let availableName = `${baseName} copy${extension}`;
  let copyNumber = 2;

  while (takenNames.has(availableName)) {
    availableName = `${baseName} copy ${copyNumber}${extension}`;
    copyNumber += 1;
  }

  return availableName;
};
