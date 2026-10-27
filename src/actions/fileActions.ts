import { FileType, Uri, window, workspace } from 'vscode';
import path from 'path';
import { getAvailableName } from '../common/paths';
import { confirmDelete, resolveConflicts } from '../ui/dialogs';
import {
  findChild,
  getTopLevelNodes,
  isInside,
} from '../model/virtualNode';
import type { VirtualNode } from '../model/virtualNode';
import type { ArchiveModel, ImportedFile } from '../model/archiveModel';

/**
 * Gets the directory an operation on a node applies to: the node itself for a
 * directory, the one holding it for a file
 */
export const getTargetDirectory = (
  node: VirtualNode,
): VirtualNode | undefined =>
  node.type === FileType.Directory ? node : node.parent;

/** Whether a node can move into a directory: not already there, and not into itself or below it */
const canMoveInto = (source: VirtualNode, target: VirtualNode): boolean =>
  source.parent !== target && !isInside(target, source) && target !== source;

/**
 * Keeps the sources that belong to the target's archive and warns about the
 * rest, since a plan targets one archive
 * @param operation - Past tense, as the warning reads it: `moved`, `copied`
 */
const getSourcesInArchive = (
  sources: readonly VirtualNode[],
  targetDirectory: VirtualNode,
  operation: string,
): VirtualNode[] => {
  const topLevelSources = getTopLevelNodes(sources);

  const sourcesInArchive = topLevelSources.filter(
    (source) => source.archive === targetDirectory.archive,
  );

  if (sourcesInArchive.length < topLevelSources.length) {
    window.showWarningMessage(
      `Entries can only be ${operation} inside the archive they belong to.`,
    );
  }

  return sourcesInArchive;
};

/**
 * Warns and returns true when any node sits in a read-only source, the game
 * install the user did not open, which no action may change
 */
const refuseReadOnly = (
  archiveModel: ArchiveModel,
  nodes: readonly VirtualNode[],
): boolean => {
  if (!nodes.some((node) => archiveModel.isReadOnly(node.archive))) {
    return false;
  }

  window.showWarningMessage(
    'The base game is read-only. Copy what you need into a folder of the workspace to change it.',
  );

  return true;
};

/**
 * Moves nodes into a directory under their own names, and reports how many
 * moved. A selection spanning several archives is safe to pass: sources
 * outside the target's archive are dropped with a warning. A name already
 * taken in the target prompts to replace, skip or cancel.
 */
export const moveNodes = async (
  archiveModel: ArchiveModel,
  sources: readonly VirtualNode[],
  targetDirectory: VirtualNode,
): Promise<number> => {
  if (refuseReadOnly(archiveModel, [targetDirectory])) {
    return 0;
  }

  const sourcesInArchive = getSourcesInArchive(
    sources,
    targetDirectory,
    'moved',
  );

  const movableSources = sourcesInArchive.filter((source) =>
    canMoveInto(source, targetDirectory),
  );

  const hasNodeConflict = (node: VirtualNode) =>
    Boolean(findChild(targetDirectory, node.name));

  const acceptedNodes = await resolveConflicts(movableSources, hasNodeConflict);

  if (!acceptedNodes.length) {
    return 0;
  }

  await archiveModel.moveNodes(acceptedNodes, targetDirectory);

  return acceptedNodes.length;
};

/**
 * Copies nodes into a directory, and reports how many were copied. A selection
 * spanning several archives is safe to pass: sources outside the target's
 * archive are dropped with a warning. The user is never prompted and nothing
 * is overwritten — a name already taken takes a copy suffix.
 */
export const copyNodes = async (
  archiveModel: ArchiveModel,
  sources: readonly VirtualNode[],
  targetDirectory: VirtualNode,
): Promise<number> => {
  if (refuseReadOnly(archiveModel, [targetDirectory])) {
    return 0;
  }

  const sourcesInArchive = getSourcesInArchive(
    sources,
    targetDirectory,
    'copied',
  );

  if (!sourcesInArchive.length) {
    return 0;
  }

  const takenNames = Array.from(
    targetDirectory.children?.values() ?? [],
    (child) => child.name,
  );
  const copies: { source: VirtualNode; targetName: string }[] = [];

  for (const source of sourcesInArchive) {
    const targetName = getAvailableName(takenNames, source.name);

    takenNames.push(targetName);
    copies.push({ source, targetName });
  }

  await archiveModel.copyNodes(copies, targetDirectory);

  return copies.length;
};

/**
 * Deletes nodes and everything below them, and reports how many top level
 * nodes went. Always confirms with the user first. Unlike a move or a copy,
 * the selection may span several archives.
 */
export const deleteNodes = async (
  archiveModel: ArchiveModel,
  nodes: readonly VirtualNode[],
): Promise<number> => {
  const topLevelNodes = getTopLevelNodes(nodes);

  if (!topLevelNodes.length || refuseReadOnly(archiveModel, topLevelNodes)) {
    return 0;
  }

  const confirmed = await confirmDelete(topLevelNodes.map((node) => node.name));

  if (!confirmed) {
    return 0;
  }

  await archiveModel.deleteNodes(topLevelNodes);

  return topLevelNodes.length;
};

/**
 * Walks the picked uris into a flat list of files, naming each one by its path
 * below the uri it came from. A local file is passed on by path so its bytes
 * only move when the archive is written; anything else has to be read into
 * memory first.
 */
const readFiles = async (sourceUris: Uri[]): Promise<ImportedFile[]> => {
  const files: ImportedFile[] = [];

  const read = async (uri: Uri, parentPath: string): Promise<void> => {
    const name = path.posix.basename(uri.path);
    const relativePath = parentPath ? `${parentPath}/${name}` : name;
    const { type, size } = await workspace.fs.stat(uri);

    if (type === FileType.File) {
      if (uri.scheme === 'file') {
        files.push({ name: relativePath, size, sourcePath: uri.fsPath });
      } else {
        const content = await workspace.fs.readFile(uri);

        files.push({ name: relativePath, size: content.length, content });
      }

      return;
    }

    if (type !== FileType.Directory) {
      return; // a symlink or an unknown type has nothing to import
    }

    const children = await workspace.fs.readDirectory(uri);

    for (const [childName] of children) {
      await read(Uri.joinPath(uri, childName), relativePath);
    }
  };

  for (const uri of sourceUris) {
    await read(uri, '');
  }

  return files;
};

/**
 * Adds files from disk into a directory, walking a picked folder for
 * everything below it, and reports how many were added. A name already taken
 * in the target prompts to replace, skip or cancel.
 */
export const importFromDisk = async (
  archiveModel: ArchiveModel,
  sourceUris: Uri[],
  targetDirectory: VirtualNode,
): Promise<number> => {
  if (refuseReadOnly(archiveModel, [targetDirectory])) {
    return 0;
  }

  const files = await readFiles(sourceUris);

  const hasFileConflict = (file: ImportedFile) =>
    Boolean(findChild(targetDirectory, file.name));

  const acceptedFiles = await resolveConflicts(files, hasFileConflict);

  if (!acceptedFiles.length) {
    return 0;
  }

  await archiveModel.addFiles(targetDirectory, acceptedFiles);

  return acceptedFiles.length;
};
