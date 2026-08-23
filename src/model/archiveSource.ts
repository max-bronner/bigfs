import { Uri, workspace } from 'vscode';

/**
 * A place archives come from. Today that is a folder of the workspace; later
 * it can be a folder added by hand, which is why an archive is identified by
 * its source and its path inside it rather than by the workspace.
 */
export interface ArchiveSource {
  /** First segment of every uri into this source, stable across sessions */
  readonly id: string;
  /** What the tree shows for the source */
  readonly label: string;
  readonly baseUri: Uri;
}

/** Turns a folder name into a uri segment, named `source` when nothing is left */
const toSlug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'source';

/** Short and stable, only needed when two folders share a name */
const toSuffix = (text: string): string => {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36).slice(0, 6);
};

/**
 * Creates one source per workspace folder, so a multi root workspace keeps
 * its folders apart the way the explorer does
 */
export const createWorkspaceSources = (): ArchiveSource[] => {
  const taken = new Set<string>();

  return (workspace.workspaceFolders ?? []).map((folder) => {
    const slug = toSlug(folder.name);
    const id = taken.has(slug)
      ? `${slug}-${toSuffix(folder.uri.fsPath)}`
      : slug;

    taken.add(id);

    return { id, label: folder.name, baseUri: folder.uri };
  });
};

/** Finds the source a file on disk belongs to, if one of them holds it */
export const findSourceFor = (
  sources: readonly ArchiveSource[],
  uri: Uri,
): ArchiveSource | undefined => {
  const wanted = uri.fsPath.toLowerCase();

  // The longest base wins, for a source nested inside another
  return sources
    .filter((source) => wanted.startsWith(source.baseUri.fsPath.toLowerCase()))
    .sort((a, b) => b.baseUri.fsPath.length - a.baseUri.fsPath.length)
    .at(0);
};

/**
 * Gets where an archive sits inside its source, which together with the
 * source id gives it a place of its own: two archives that share a name stay
 * apart because the folders holding them differ.
 */
export const getPathInSource = (source: ArchiveSource, uri: Uri): string =>
  uri.fsPath
    .slice(source.baseUri.fsPath.length)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
