import path from 'path';
import { Uri, WorkspaceEdit, window, workspace } from 'vscode';
import { toArchiveFileName } from '../../core/entryName';
import { askForName, confirmDeleteArchives } from '../../platform/dialogs';
import { createArchiveFile } from '../../node/createArchiveFile';
import { refuseDirtyEditors } from './dirtyEditors';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import type { ExplorerRow } from '../../services/archives/explorerRow';
import type { VirtualNode } from '../../services/archives/virtualNode';
import { isFolderRow, isSourceRow } from '../../services/archives/explorerRow';

const READ_ONLY_MESSAGE =
  'The base game is read-only. Copy what you need into a folder of the workspace to change it.';

/** Gets the names of the files in a folder on disk, to keep a new archive name from colliding */
const readFileNames = async (folder: Uri): Promise<Set<string>> =>
  new Set((await workspace.fs.readDirectory(folder)).map(([name]) => name));

/**
 * Gets the folder on disk a source or folder row stands for, and the id of the
 * source it belongs to
 */
const getRowFolder = (
  archiveModel: ArchiveModel,
  row: ExplorerRow,
): { folder: Uri; sourceId: string } | undefined => {
  const sourceId = isSourceRow(row)
    ? row.source.id
    : isFolderRow(row)
      ? row.sourceId
      : undefined;
  const source = archiveModel.getSources().find((each) => each.id === sourceId);

  if (!source || !sourceId) {
    return undefined;
  }

  return {
    folder: isFolderRow(row)
      ? Uri.joinPath(source.baseUri, row.path)
      : source.baseUri,
    sourceId,
  };
};

/**
 * Creates an empty archive in the folder a row stands for, after asking for
 * its name. The `.big` extension is added when left off, and a name that
 * differs from a file there only in case is refused.
 */
export const createArchive = async (
  archiveModel: ArchiveModel,
  row: ExplorerRow,
): Promise<void> => {
  const target = getRowFolder(archiveModel, row);

  if (!target) {
    return;
  }

  if (archiveModel.isSourceReadOnly(target.sourceId)) {
    window.showWarningMessage(READ_ONLY_MESSAGE);

    return;
  }

  if (target.folder.scheme !== 'file') {
    window.showWarningMessage('A new archive can only be created on a local disk.');

    return;
  }

  const name = await askForName({
    title: 'New Archive',
    takenNames: await readFileNames(target.folder),
    normalizeName: toArchiveFileName,
  });

  if (!name) {
    return;
  }

  try {
    await createArchiveFile(path.join(target.folder.fsPath, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      window.showErrorMessage(`${name} already exists here.`);

      return;
    }

    throw error;
  }

  window.showInformationMessage(
    `Created ${name}. Right-click it to add files, or drop them on it.`,
  );
};

/**
 * Copies dropped archives into the folder a row stands for and reports how
 * many arrived. Anything that is not a local `.big` file is ignored, and a
 * name the folder already holds, in any casing, is left alone rather than
 * overwritten.
 */
export const copyArchivesInto = async (
  archiveModel: ArchiveModel,
  row: ExplorerRow,
  sourceUris: readonly Uri[],
): Promise<number> => {
  const target = getRowFolder(archiveModel, row);
  const archives = sourceUris.filter(
    (uri) => uri.scheme === 'file' && /\.big$/i.test(uri.path),
  );

  if (!target || !archives.length) {
    return 0;
  }

  if (archiveModel.isSourceReadOnly(target.sourceId)) {
    window.showWarningMessage(READ_ONLY_MESSAGE);

    return 0;
  }

  const taken = new Set(
    Array.from(await readFileNames(target.folder), (name) => name.toLowerCase()),
  );
  let copied = 0;

  for (const uri of archives) {
    const name = path.basename(uri.fsPath);

    if (taken.has(name.toLowerCase())) {
      window.showWarningMessage(`${name} already exists there, so it was not copied.`);
      continue;
    }

    taken.add(name.toLowerCase());
    await workspace.fs.copy(uri, Uri.joinPath(target.folder, name), {
      overwrite: false,
    });
    copied += 1;
  }

  return copied;
};

/**
 * Renames an archive on disk from a prompt. Goes through a workspace edit, so
 * other extensions hear of the rename and the archive keeps its place in the
 * tree once the watcher sees the new name.
 */
export const renameArchive = async (
  archiveModel: ArchiveModel,
  root: VirtualNode,
): Promise<void> => {
  if (archiveModel.isReadOnly(root.archive)) {
    window.showWarningMessage(READ_ONLY_MESSAGE);

    return;
  }

  if (refuseDirtyEditors([root], 'rename')) {
    return;
  }

  const oldPath = root.archive.archivePath;
  const name = await askForName({
    title: 'Rename Archive',
    takenNames: await readFileNames(Uri.file(path.dirname(oldPath))),
    currentName: path.basename(oldPath),
    normalizeName: toArchiveFileName,
  });

  if (!name || name === path.basename(oldPath)) {
    return;
  }

  const edit = new WorkspaceEdit();

  edit.renameFile(Uri.file(oldPath), Uri.file(path.join(path.dirname(oldPath), name)), {
    overwrite: false,
  });

  if (!(await workspace.applyEdit(edit))) {
    window.showErrorMessage(`Could not rename ${path.basename(oldPath)}.`);
  }
};

/**
 * Moves archives to the trash after confirming, and reports how many went.
 * Archives of a read-only source are refused, and so is one with unsaved
 * editors.
 */
export const deleteArchives = async (
  archiveModel: ArchiveModel,
  roots: readonly VirtualNode[],
): Promise<number> => {
  if (roots.some((root) => archiveModel.isReadOnly(root.archive))) {
    window.showWarningMessage(READ_ONLY_MESSAGE);

    return 0;
  }

  if (refuseDirtyEditors(roots, 'delete')) {
    return 0;
  }

  const names = roots.map((root) => root.archive.name);

  if (!(await confirmDeleteArchives(names))) {
    return 0;
  }

  for (const root of roots) {
    await workspace.fs.delete(Uri.file(root.archive.archivePath), {
      useTrash: true,
    });
  }

  return roots.length;
};
