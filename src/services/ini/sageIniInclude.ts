import { Uri, workspace } from 'vscode';

/**
 * Resolves an `#include` path to the entry it names.
 *
 * The rules come from the engine, not from the host: the path is relative to
 * the directory of the including file, always written with backslashes, and
 * compared without regard to casing - the corpus writes `Includes\` and
 * `includes\` for the same folder. Nothing here is specific to archives, so an
 * include resolves the same way for a file on disk.
 */

/** Applies `.` and `..` to a split path, the way the engine's loader does */
const normalize = (segments: readonly string[]): string[] => {
  const resolved: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      resolved.pop();
      continue;
    }

    resolved.push(segment);
  }

  return resolved;
};

/**
 * Resolves the uri an include names, relative to the document holding it. The result is
 * where the entry would be; whether it exists is a separate question, since a
 * mod can reference a file it does not ship.
 */
export const resolveIncludeUri = (
  documentUri: Uri,
  includePath: string,
): Uri => {
  const directory = documentUri.path.split('/').slice(0, -1);
  const relative = includePath.split(/[\\/]/);
  const resolved = normalize([...directory, ...relative]);

  // Every uri here is absolute, and normalize drops the empty leading segment
  return documentUri.with({ path: `/${resolved.join('/')}` });
};

/**
 * Whether an entry exists at a uri. The file system provider folds case, so a
 * path written with different casing than the entry it names still resolves,
 * which the corpus relies on.
 */
export const includeExists = async (uri: Uri): Promise<boolean> => {
  try {
    await workspace.fs.stat(uri);

    return true;
  } catch {
    return false;
  }
};
