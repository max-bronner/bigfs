import path from 'path';

/** Helpers for '/' separated paths, never the platform's separator */

/** Gets the parent path, empty for a path that has no parent */
export const getParentPath = (nodePath: string): string => {
  const separatorIndex = nodePath.lastIndexOf('/');

  return separatorIndex < 0 ? '' : nodePath.slice(0, separatorIndex);
};

/** Splits a path into segments, dropping empty ones so a leading slash costs nothing */
export const splitPath = (nodePath: string): string[] =>
  nodePath.split('/').filter((segment) => segment.length);

/** Whether a path sits below an ancestor path, counting the ancestor itself */
export const isPathBelow = (nodePath: string, ancestorPath: string): boolean =>
  nodePath === ancestorPath || nodePath.startsWith(`${ancestorPath}/`);

/**
 * Whether an entry path stays inside the directory it is extracted to: no `..`
 * segment, no leading separator and no drive prefix. No shipped archive breaks
 * this, so an archive that does was crafted to write outside the target.
 */
export const isContainedPath = (entryPath: string): boolean => {
  const segments = entryPath.split(/[\\/]/);

  return (
    segments[0] !== '' &&
    !/^[a-z]:$/i.test(segments[0]) &&
    !segments.includes('..')
  );
};

/** Repoints a path from below one entry to below another */
export const movePath = (
  nodePath: string,
  sourcePath: string,
  targetPath: string,
): string =>
  nodePath === sourcePath
    ? targetPath
    : `${targetPath}${nodePath.slice(sourcePath.length)}`;

/**
 * Appends a copy suffix until the name is free. Taken names are matched case
 * insensitively, as archives match them.
 */
export const getAvailableName = (
  takenNames: Iterable<string>,
  name: string,
): string => {
  const taken = new Set(
    Array.from(takenNames, (takenName) => takenName.toLowerCase()),
  );

  if (!taken.has(name.toLowerCase())) {
    return name;
  }

  const extension = path.posix.extname(name);
  const baseName = name.slice(0, name.length - extension.length);

  let availableName = `${baseName} copy${extension}`;
  let copyNumber = 2;

  while (taken.has(availableName.toLowerCase())) {
    availableName = `${baseName} copy ${copyNumber}${extension}`;
    copyNumber += 1;
  }

  return availableName;
};
